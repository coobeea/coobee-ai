/**
 * FileSession — 带序号和元数据的 Session 持久化
 *
 * 实现 SDK Session 接口 + JSONL 文件存储。
 * 每行存储一个 SessionItem（包含序号、类型、SDK 原始数据和可选元数据）。
 *
 * 存储路径：{basePath}/sessions/{sessionId}/messages.jsonl
 *
 * 核心能力：
 *   - getItems()：智能上下文构建（找到最后 summary → 返回总结上下文 + 后续消息）
 *   - addItems()：自动分配递增序号，包装为 SessionItem 后追加
 *   - getAllSessionItems()：返回完整 SessionItem[]（含 summary，供压缩器使用）
 *   - appendSummaryItem()：追加一条 type=summary 的 SessionItem
 *   - getLastSummary()：快速获取最后一个 summary 的元数据
 */

import type { Session, AgentInputItem } from '@openai/agents'
import { mkdir, writeFile, readFile, truncate } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import type { SessionItem, SummaryMeta } from './types'

/**
 * 基于文件的 Session 实现
 *
 * 将 SDK AgentInputItem 以 SessionItem JSONL 格式持久化到磁盘。
 * 对 SDK 完全透明：getItems() 返回 AgentInputItem[]，addItems() 接受 AgentInputItem[]。
 */
export class FileSession implements Session {
  private readonly filePath: string
  private initialized = false

  /**
   * @param sessionId 会话 ID
   * @param sessionDir 会话存储根目录（直接包含 {sessionId}/ 子目录）。
   *   不传则使用默认路径：{Electron userData}/sessions 或 ~/.coobee-ai/sessions
   */
  constructor(
    private readonly sessionId: string,
    sessionDir?: string
  ) {
    const dir = sessionDir || FileSession.getDefaultSessionDir()
    this.filePath = join(dir, sessionId, 'messages.jsonl')
  }

  /**
   * 获取默认会话存储目录
   *
   * Electron 环境：{userData}/sessions
   * 非 Electron 环境（测试等）：~/.coobee-ai/sessions
   */
  private static getDefaultSessionDir(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      return join(app.getPath('userData'), 'sessions')
    } catch {
      return join(process.env.HOME || '/tmp', '.coobee-ai', 'sessions')
    }
  }

  /**
   * 确保目录和文件存在
   */
  private async ensureFile(): Promise<void> {
    if (this.initialized) return

    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    if (!existsSync(this.filePath)) {
      await writeFile(this.filePath, '', 'utf-8')
    }
    this.initialized = true
  }

  // ========== SDK Session 接口实现 ==========

  async getSessionId(): Promise<string> {
    return this.sessionId
  }

  /**
   * 获取对话历史（智能上下文构建）
   *
   * SDK 在每次 run() 前调用此方法获取上下文。
   *
   * 逻辑：
   *   1. 读取全部 SessionItem
   *   2. 找到最后一个 type=summary 的项
   *   3. 若有 summary → 返回 [总结上下文(user+assistant对) + seq>endSeq 的 message items]
   *   4. 若无 summary → 返回所有 message items
   */
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const allItems = await this.readAllSessionItems()

    // 找到最后一个 summary
    const lastSummary = this.findLastSummary(allItems)

    let result: AgentInputItem[]

    if (lastSummary && lastSummary.meta) {
      // 有 summary：构建 [总结上下文 + 后续消息]
      const summaryContext = this.buildSummaryContext(lastSummary.meta)
      const afterItems = allItems
        .filter((si) => si.seq > lastSummary.meta!.endSeq && si.type === 'message')
        .map((si) => si.item)
      result = [...summaryContext, ...afterItems]
    } else {
      // 无 summary：返回所有 message items
      result = allItems.filter((si) => si.type === 'message').map((si) => si.item)
    }

    return limit ? result.slice(-limit) : result
  }

  /**
   * 追加新的对话项
   *
   * SDK 在每次 run() 后调用此方法保存新消息。
   * 自动分配递增序号，包装为 SessionItem。
   */
  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return
    await this.ensureFile()

    const nextSeq = await this.getNextSeq()
    const now = Date.now()

    const sessionItems: SessionItem[] = items.map((item, i) => ({
      seq: nextSeq + i,
      type: 'message' as const,
      item,
      ts: now
    }))

    const lines = sessionItems.map((si) => JSON.stringify(si)).join('\n') + '\n'
    await writeFile(this.filePath, lines, { flag: 'a' })
  }

  /**
   * 弹出最后一条记录
   * SDK 在某些场景下需要此功能（如撤销最后一条）
   */
  async popItem(): Promise<AgentInputItem | undefined> {
    await this.ensureFile()

    try {
      const content = await readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim())

      if (lines.length === 0) return undefined

      const lastSessionItem = JSON.parse(lines[lines.length - 1]) as SessionItem
      const remaining = lines.slice(0, -1)

      // 重写文件（去掉最后一行）
      await writeFile(
        this.filePath,
        remaining.length > 0 ? remaining.join('\n') + '\n' : '',
        'utf-8'
      )

      return lastSessionItem.item
    } catch {
      return undefined
    }
  }

  /**
   * 清空会话
   */
  async clearSession(): Promise<void> {
    await this.ensureFile()

    try {
      await truncate(this.filePath, 0)
    } catch {
      // 文件可能不存在，忽略
      await writeFile(this.filePath, '', 'utf-8')
    }
  }

  // ========== 压缩相关方法 ==========

  /**
   * 获取全部 SessionItem（含 summary，供压缩器使用）
   */
  async getAllSessionItems(): Promise<SessionItem[]> {
    return this.readAllSessionItems()
  }

  /**
   * 追加一条 type=summary 的 SessionItem
   *
   * 由 SessionCompressor 调用，将压缩总结追加到 Session 文件末尾。
   * item 字段为占位（空 assistant 消息），实际总结内容在 meta.summaryText 中。
   *
   * @param meta 总结元数据
   */
  async appendSummaryItem(meta: SummaryMeta): Promise<void> {
    await this.ensureFile()

    const nextSeq = await this.getNextSeq()

    const summaryItem: SessionItem = {
      seq: nextSeq,
      type: 'summary',
      item: {
        role: 'assistant',
        content: `[session_summary] ${meta.summaryText.slice(0, 100)}...`
      } as unknown as AgentInputItem,
      meta,
      ts: Date.now()
    }

    const line = JSON.stringify(summaryItem) + '\n'
    await writeFile(this.filePath, line, { flag: 'a' })
  }

  /**
   * 获取最后一个 summary 的元数据
   *
   * @returns SummaryMeta 或 undefined（如果没有 summary）
   */
  async getLastSummary(): Promise<SummaryMeta | undefined> {
    const allItems = await this.readAllSessionItems()
    const lastSummary = this.findLastSummary(allItems)
    return lastSummary?.meta
  }

  // ========== 辅助方法 ==========

  /**
   * 获取消息数量（仅计 type=message）
   */
  async getItemCount(): Promise<number> {
    const allItems = await this.readAllSessionItems()
    return allItems.filter((si) => si.type === 'message').length
  }

  /**
   * 获取文件路径（用于调试）
   */
  getFilePath(): string {
    return this.filePath
  }

  // ========== 内部实现 ==========

  /**
   * 读取全部 SessionItem
   *
   * 自动检测文件格式：
   *   - 新格式：每行是 SessionItem（有 seq 字段）
   *   - 旧格式：每行是裸 AgentInputItem（无 seq 字段），自动迁移
   */
  private async readAllSessionItems(): Promise<SessionItem[]> {
    await this.ensureFile()

    try {
      const content = await readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim())

      if (lines.length === 0) return []

      const items: SessionItem[] = []
      for (let i = 0; i < lines.length; i++) {
        const parsed = JSON.parse(lines[i]) as Record<string, unknown>

        if (typeof parsed.seq === 'number' && typeof parsed.type === 'string') {
          // 新格式：SessionItem
          items.push(parsed as unknown as SessionItem)
        } else {
          // 旧格式：裸 AgentInputItem → 自动包装
          items.push({
            seq: i + 1,
            type: 'message',
            item: parsed as unknown as AgentInputItem,
            ts: 0
          })
        }
      }

      return items
    } catch {
      return []
    }
  }

  /**
   * 获取下一个可用的序号
   */
  private async getNextSeq(): Promise<number> {
    const items = await this.readAllSessionItems()
    if (items.length === 0) return 1
    return Math.max(...items.map((si) => si.seq)) + 1
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

  /**
   * 从 SummaryMeta 构建总结上下文（user + assistant 消息对）
   *
   * 这种格式让 LLM 将总结理解为已确认的历史上下文，而非需要回答的新问题。
   */
  private buildSummaryContext(meta: SummaryMeta): AgentInputItem[] {
    // 清洗 summaryText 中可能残留的 <think> 标签
    const cleanSummary = meta.summaryText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

    const userItem = {
      role: 'user',
      content:
        '以下是我们之前对话的总结，请记住其中的所有信息（包括我的个人信息、项目细节、技术决策等），并在后续对话中使用：\n\n' +
        cleanSummary
    } as unknown as AgentInputItem

    const assistantItem = {
      role: 'assistant',
      content: '好的，我已仔细阅读并记住了以上对话总结中的所有信息。请继续。'
    } as unknown as AgentInputItem

    return [userItem, assistantItem]
  }
}
