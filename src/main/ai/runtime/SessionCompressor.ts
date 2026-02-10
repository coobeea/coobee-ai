/**
 * Session 压缩器
 *
 * 当对话历史过长（token 接近上下文窗口限制）时，
 * 自动将旧消息压缩为结构化总结，追加到 Session 文件中。
 *
 * 策略（参考 Joythink-AI SessionSummaryMiddleware）：
 *   1. 读取全部 SessionItem，找到最后一个 summary
 *   2. 计算未压缩消息的 token 总量
 *   3. 若超过 contextWindowSize * thresholdRatio，触发压缩
 *   4. 将未压缩消息分为前 70% 待总结 + 后 30% 保留
 *   5. 调用 LLM 生成结构化总结（包含上次 summary 的文本作为上下文）
 *   6. 追加 summary SessionItem 到文件（原始消息保留不动）
 *
 * 设计原则：
 *   - 追加式压缩：不删除/替换原始消息，仅追加 summary 项
 *   - 序号感知：基于 SessionItem.seq 跟踪压缩边界
 *   - 增量总结：新总结包含上次总结的文本，确保历史信息不丢失
 *   - 使用 tokenx 进行准确的 token 估算（94% 准确度）
 */

import { Agent, run } from '@openai/agents'
import type { AgentInputItem } from '@openai/agents'
import type { FileSession } from './FileSession'
import type {
  SessionCompressionOptions,
  CompressionResult,
  SessionItem,
  SummaryMeta
} from './types'
import { countTokens, countItemsTokens } from './tokenCounter'

/** 默认配置 */
const DEFAULTS: Required<SessionCompressionOptions> = {
  enabled: false,
  contextWindowSize: 128000,
  thresholdRatio: 0.7,
  keepRatio: 0.3,
  minMessageCount: 10,
  summaryModel: '',
  debug: false
}

/** 总结 Agent 的 system prompt */
const SUMMARY_INSTRUCTIONS = `你是一个专业的对话总结工具。你的唯一任务是：从对话记录中提取并列出所有关键信息。

**严格要求**：
- 直接输出总结内容，不要输出任何思考过程
- 不要使用 <think> 标签
- 不要添加任何解释或评论
- 只输出结构化的信息列表

**输出格式**（直接用以下 Markdown 格式输出）：

## 用户信息
- 姓名：XXX
- 年龄：XXX
- 职业：XXX
- 工作地点：XXX
- 其他个人信息...

## 项目信息
- 项目名：XXX
- 项目类型：XXX
- 技术栈：XXX
- 其他项目细节...

## 对话要点
- 要点 1
- 要点 2

## 用户偏好与决策
- 偏好 1
- 决策 1

## 待办/下一步
- 事项 1

**关键规则**：
1. 用户提到的姓名、年龄、职业、工作单位 → 必须逐项列出，不可省略
2. 项目名称、技术栈（每一项）→ 必须逐项列出
3. 如果某个部分无信息，写"无"
4. 如果有上一次的总结内容，在此基础上更新和合并，不丢失旧信息`

export class SessionCompressor {
  private readonly options: Required<SessionCompressionOptions>

  constructor(options?: SessionCompressionOptions) {
    this.options = { ...DEFAULTS, ...options }
  }

  /**
   * 检查并执行压缩（如果需要）
   *
   * @param session FileSession 实例
   * @param model 默认模型名称（当 summaryModel 未配置时使用）
   * @returns 压缩结果
   */
  async compressIfNeeded(session: FileSession, model: string): Promise<CompressionResult> {
    if (!this.options.enabled) {
      return { compressed: false }
    }

    // 读取全部 SessionItem
    const allItems = await session.getAllSessionItems()

    // 找到最后一个 summary，获取未压缩消息
    const lastSummary = this.findLastSummary(allItems)
    const lastEndSeq = lastSummary?.meta?.endSeq || 0
    const unsummarized = allItems.filter((si) => si.seq > lastEndSeq && si.type === 'message')

    // 检查最小消息数
    if (unsummarized.length < this.options.minMessageCount) {
      if (this.options.debug) {
        console.log(
          `[SessionCompressor] 未压缩消息不足 ${this.options.minMessageCount} 条` +
            `（当前 ${unsummarized.length}），跳过`
        )
      }
      return { compressed: false }
    }

    // 估算 token 数
    const unsummarizedItems = unsummarized.map((si) => si.item)
    const totalTokens = countItemsTokens(unsummarizedItems)
    const threshold = this.options.contextWindowSize * this.options.thresholdRatio

    if (this.options.debug) {
      console.log(
        `[SessionCompressor] Token 检查: ${totalTokens} / ${threshold} ` +
          `(${((totalTokens / threshold) * 100).toFixed(1)}%)`
      )
    }

    // 未达到阈值
    if (totalTokens < threshold) {
      return { compressed: false }
    }

    // 执行压缩
    return this.compress(session, unsummarized, lastSummary, model, totalTokens, threshold)
  }

  /**
   * 获取当前压缩状态信息（用于 compression:start 事件）
   */
  async getCompressionStatus(
    session: FileSession
  ): Promise<{ totalTokens: number; threshold: number } | null> {
    if (!this.options.enabled) return null

    const allItems = await session.getAllSessionItems()
    const lastSummary = this.findLastSummary(allItems)
    const lastEndSeq = lastSummary?.meta?.endSeq || 0
    const unsummarized = allItems.filter((si) => si.seq > lastEndSeq && si.type === 'message')

    const unsummarizedItems = unsummarized.map((si) => si.item)
    const totalTokens = countItemsTokens(unsummarizedItems)
    const threshold = this.options.contextWindowSize * this.options.thresholdRatio

    return { totalTokens, threshold }
  }

  /**
   * 执行压缩
   */
  private async compress(
    session: FileSession,
    unsummarized: SessionItem[],
    lastSummary: SessionItem | undefined,
    model: string,
    totalTokens: number,
    _threshold: number
  ): Promise<CompressionResult> {
    const startTime = Date.now()
    const summaryModel = this.options.summaryModel || model

    try {
      // 1. 分段：前 (1-keepRatio) 待总结，后 keepRatio 保留
      const splitIndex = Math.floor(unsummarized.length * (1 - this.options.keepRatio))
      const toSummarize = unsummarized.slice(0, splitIndex)
      const toKeep = unsummarized.slice(splitIndex)

      if (this.options.debug) {
        console.log(
          `[SessionCompressor] 分段: 未压缩 ${unsummarized.length} 条，` +
            `总结 ${toSummarize.length} 条，保留 ${toKeep.length} 条`
        )
      }

      if (toSummarize.length === 0) {
        console.warn('[SessionCompressor] 没有可总结的消息')
        return { compressed: false }
      }

      // 2. 构建待总结内容（包含上次总结的文本作为上下文）
      let contentToSummarize = ''

      // 增量总结：包含上次 summary 的文本
      if (lastSummary?.meta?.summaryText) {
        contentToSummarize += `[之前的对话总结]\n${lastSummary.meta.summaryText}\n\n[新的对话内容]\n`
      }

      contentToSummarize += this.buildContentForSummary(toSummarize.map((si) => si.item))

      if (!contentToSummarize.trim()) {
        console.warn('[SessionCompressor] 没有需要总结的内容')
        return { compressed: false }
      }

      // 3. 调用 LLM 生成总结
      const summaryText = await this.generateSummary(contentToSummarize, summaryModel)
      if (!summaryText?.trim()) {
        console.warn('[SessionCompressor] 生成的总结为空')
        return { compressed: false }
      }

      // 4. 计算统计信息
      const summarizedSeqs = toSummarize.map((si) => si.seq)
      const endSeq = Math.max(...summarizedSeqs)
      const summaryTokens = countTokens(summaryText)
      const duration = Date.now() - startTime
      const compressionRatio = totalTokens > 0 ? summaryTokens / totalTokens : 0

      // 5. 构造 SummaryMeta
      const meta: SummaryMeta = {
        summaryText: summaryText.trim(),
        summarizedSeqs,
        endSeq,
        originalTokens: totalTokens,
        summaryTokens,
        compressionRatio,
        duration
      }

      // 6. 追加 summary 到文件
      await session.appendSummaryItem(meta)

      const result: CompressionResult = {
        compressed: true,
        originalCount: unsummarized.length,
        summarizedCount: toSummarize.length,
        keptCount: toKeep.length,
        summarizedSeqs,
        endSeq,
        originalTokens: totalTokens,
        summaryTokens,
        compressionRatio,
        duration
      }

      if (this.options.debug) {
        console.log(
          `[SessionCompressor] 压缩完成: ` +
            `${result.summarizedCount} 条已总结 (seq ${summarizedSeqs[0]}-${endSeq})，` +
            `${result.keptCount} 条保留, ` +
            `tokens: ${result.originalTokens} → ${result.summaryTokens}, ` +
            `压缩比: ${((result.compressionRatio || 0) * 100).toFixed(1)}%, ` +
            `耗时: ${duration}ms`
        )
      }

      return result
    } catch (error) {
      console.error('[SessionCompressor] 压缩失败:', error)
      // 压缩失败不影响主流程
      return { compressed: false }
    }
  }

  /**
   * 调用 LLM 生成总结
   */
  private async generateSummary(content: string, model: string): Promise<string> {
    const summaryAgent = new Agent({
      name: 'SessionSummarizer',
      instructions: SUMMARY_INSTRUCTIONS,
      model
    })

    const result = await run(summaryAgent, content, {
      maxTurns: 1
    })

    let output = (result.finalOutput as string) || ''

    // 清洗模型可能输出的 <think> 标签
    output = this.stripThinkTags(output)

    return output
  }

  /**
   * 将 AgentInputItem[] 格式化为可读的对话内容（供 LLM 总结）
   */
  private buildContentForSummary(items: AgentInputItem[]): string {
    const lines: string[] = []

    for (const item of items) {
      try {
        const raw = item as Record<string, unknown>
        const role = raw.role as string | undefined
        const type = raw.type as string | undefined

        if (role === 'user') {
          const content = this.extractTextContent(raw)
          if (content) lines.push(`用户: ${content}`)
        } else if (role === 'assistant') {
          let content = this.extractTextContent(raw)
          // 清洗 assistant 回复中的 <think> 标签（模型思考过程不应纳入总结）
          content = this.stripThinkTags(content)
          if (content.trim()) lines.push(`助手: ${content.trim()}`)
        } else if (type === 'function_call') {
          const name = (raw.name as string) || '未知工具'
          const args = (raw.arguments as string) || '{}'
          lines.push(`[工具调用: ${name}] 参数: ${args.slice(0, 200)}`)
        } else if (type === 'function_call_output' || role === 'tool') {
          const output = (raw.output as string) || (raw.content as string) || ''
          const display = output.length > 200 ? output.slice(0, 200) + '...' : output
          lines.push(`[工具结果] ${display}`)
        }
      } catch {
        // 跳过解析失败的 item
      }
    }

    return lines.join('\n\n')
  }

  /**
   * 从 AgentInputItem 中提取文本内容
   *
   * SDK 的消息 content 可能是 string 或 Array<{type, text}>
   */
  private extractTextContent(item: Record<string, unknown>): string {
    const content = item.content
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      return content
        .map((part: unknown) => {
          if (typeof part === 'object' && part !== null) {
            const p = part as Record<string, unknown>
            return (p.text as string) || (p.content as string) || ''
          }
          return ''
        })
        .filter(Boolean)
        .join('')
    }
    return ''
  }

  /**
   * 移除文本中的 <think>...</think> 标签及其内容
   *
   * MiniMax 等模型会在输出中包含思考过程标签，
   * 这些内容不应该被纳入对话总结。
   */
  private stripThinkTags(text: string): string {
    if (!text) return ''
    // 移除 <think>...</think> 块（支持多行）
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  }

  /**
   * 从 SessionItem 列表中找到最后一个 summary
   */
  private findLastSummary(items: SessionItem[]): SessionItem | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'summary' && items[i].meta) {
        return items[i]
      }
    }
    return undefined
  }
}
