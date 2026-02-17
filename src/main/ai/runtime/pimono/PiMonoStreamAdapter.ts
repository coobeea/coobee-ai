/**
 * PiMono 流式事件适配器
 *
 * 将 pi-coding-agent SDK 的 AgentSessionEvent 映射为统一的 StreamChunk。
 *
 * 职责：
 *   - 事件订阅：session.subscribe() 回调 → StreamChunk
 *   - <think> 标签解析：自动拆分 <think>...</think> 为 reasoning:* 事件
 *   - Turn 边界管理：turn_start/turn_end → turn:start/turn:done
 *   - 工具事件桥接：tool_execution_start/update/end → tool:start/delta/done
 *   - 压缩事件透传：auto_compaction_start/end → compression:start/done
 *
 * 从 PiMonoAgentRuntime.ts 提取，保持 Runtime 只做生命周期编排。
 *
 * @module runtime/pimono/PiMonoStreamAdapter
 */

import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { StreamChunk, ExecutionResult } from '../types'

// ========== Types ==========

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/** 事件订阅回调集合 */
export interface StreamAdapterCallbacks {
  /** 推送 StreamChunk */
  onChunk: (chunk: StreamChunk) => void
  /** 文本增量回调（累积完整输出） */
  onTextDelta: (text: string) => void
  /** 工具调用记录列表 */
  toolCalls: ExecutionResult['toolCalls']
  /** API 错误回调 */
  onApiError?: (errorMessage: string) => void
}

// ========== Core API ==========

/**
 * 设置 pi-SDK 事件订阅
 *
 * 事件分发：
 *   onChunk() → queue → yield → AgentExecutor.forward() 统一广播到 EventBus
 *
 * <think> 标签解析：
 *   OpenAI Chat Completions 格式不原生支持思考块，部分 Provider（如 MiniMax）
 *   会将思考内容以 <think>...</think> 标签包裹在文本中返回。
 *   本方法自动检测并分离 <think> 标签，将思考内容作为 reasoning:* 事件发出，
 *   确保无论底层 API 格式如何，上层都能获得一致的事件接口。
 *
 *   状态机：
 *     NORMAL → (遇到 <think>) → IN_THINK → (遇到 </think>) → NORMAL
 *
 * 与 OpenAI 实现的关键差异：
 *   - turn_start / turn_end 由 SDK 直接给出（无需推断）
 *   - thinking_delta 是独立事件（通过 SDK 原生或 <think> 解析）
 *   - tool_execution_update 提供工具执行进度
 *
 * @param session pi-SDK AgentSession 实例
 * @param callbacks 事件回调集合
 * @param log 日志器
 * @returns 取消订阅函数
 */
export function setupEventSubscription(
  session: AgentSession,
  callbacks: StreamAdapterCallbacks,
  log: RuntimeLogger
): () => void {
  const { onChunk, onTextDelta, toolCalls, onApiError } = callbacks

  let turnIndex = 0
  let textStartEmitted = false
  let reasoningStartEmitted = false

  // <think> 标签解析状态
  let inThinkBlock = false
  let thinkingBuffer = ''
  let realTextStartEmitted = false // 是否已发出去除 <think> 后的真正 text:start

  /**
   * 发出去除 <think> 后的纯文本 delta
   */
  const emitCleanText = (text: string): void => {
    if (!text || text.length === 0) return

    // 确保 text:start 已发出
    if (!realTextStartEmitted) {
      onChunk({ type: 'text:start', content: '' })
      realTextStartEmitted = true
    }

    onTextDelta(text)
    onChunk({ type: 'text:delta', content: text, data: { delta: text } })
  }

  /**
   * 处理 text_delta 中的 <think> 标签
   *
   * 将包含 <think>...</think> 的文本流拆分为：
   *   - <think> 内的内容 → reasoning:start/delta/done
   *   - <think> 外的内容 → text:start/delta
   */
  const processTextDelta = (rawDelta: string): void => {
    if (!rawDelta) return

    let remaining = rawDelta

    while (remaining.length > 0) {
      if (!inThinkBlock) {
        // 当前在普通文本模式，查找 <think> 开始标签
        const thinkStart = remaining.indexOf('<think>')
        if (thinkStart === -1) {
          // 无 <think> 标签，整段都是普通文本
          emitCleanText(remaining)
          break
        }

        // <think> 之前的内容作为普通文本
        if (thinkStart > 0) {
          emitCleanText(remaining.slice(0, thinkStart))
        }

        // 进入思考模式
        inThinkBlock = true
        thinkingBuffer = ''
        if (!reasoningStartEmitted) {
          reasoningStartEmitted = true
          onChunk({ type: 'reasoning:start', content: '' })
        }

        remaining = remaining.slice(thinkStart + '<think>'.length)
      } else {
        // 当前在思考模式，查找 </think> 结束标签
        const thinkEnd = remaining.indexOf('</think>')
        if (thinkEnd === -1) {
          // 未找到结束标签，整段都是思考内容
          thinkingBuffer += remaining
          if (remaining.length > 0) {
            onChunk({
              type: 'reasoning:delta',
              content: remaining,
              data: { delta: remaining }
            })
          }
          break
        }

        // </think> 之前的内容作为思考内容
        const thinkContent = remaining.slice(0, thinkEnd)
        if (thinkContent.length > 0) {
          thinkingBuffer += thinkContent
          onChunk({
            type: 'reasoning:delta',
            content: thinkContent,
            data: { delta: thinkContent }
          })
        }

        // 结束思考块
        inThinkBlock = false
        onChunk({
          type: 'reasoning:done',
          content: '',
          data: { rawContent: thinkingBuffer }
        })

        remaining = remaining.slice(thinkEnd + '</think>'.length)
      }
    }
  }

  return session.subscribe((event: AgentSessionEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evt = event as any

    switch (event.type) {
      // ===== Turn（SDK 直接给！无需推断！）=====
      case 'turn_start':
        turnIndex++
        textStartEmitted = false
        reasoningStartEmitted = false
        inThinkBlock = false
        thinkingBuffer = ''
        realTextStartEmitted = false
        onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
        break

      case 'turn_end':
        onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
        break

      // ===== Message（LLM 流式）=====
      case 'message_start':
        // 只为 assistant 消息发出 llm:start（user 消息不是 LLM 调用）
        if (evt.message?.role === 'assistant') {
          onChunk({ type: 'llm:start', content: '' })
        }
        break

      case 'message_update': {
        const msgEvent = evt.assistantMessageEvent
        if (!msgEvent) break

        switch (msgEvent.type) {
          // ===== 思考流（SDK 原生支持时直接转发）=====
          case 'thinking_start':
            reasoningStartEmitted = true
            onChunk({ type: 'reasoning:start', content: '' })
            break

          case 'thinking_delta': {
            const delta = msgEvent.delta || ''
            if (delta) {
              onChunk({
                type: 'reasoning:delta',
                content: delta,
                data: { delta }
              })
            }
            break
          }

          case 'thinking_end':
            onChunk({
              type: 'reasoning:done',
              content: '',
              data: {
                rawContent: msgEvent.content || ''
              }
            })
            break

          // ===== 文本流（含 <think> 标签自动解析）=====
          case 'text_start':
            textStartEmitted = true
            // 不立即发 text:start，等 processTextDelta 确认有真正文本后再发
            break

          case 'text_delta': {
            const delta = msgEvent.delta || ''
            if (delta) {
              processTextDelta(delta)
            }
            break
          }

          case 'text_end': {
            // 提取去除 <think> 后的纯文本
            const rawFullText = msgEvent.content || extractFullText(evt.message)
            const cleanText = stripThinkTags(rawFullText)

            // 始终发出 text:start + text:done（即使纯文本为空）
            // 与 OpenAI 行为一致：工具调用轮也会有 text:start/text:done 闭环
            if (!realTextStartEmitted) {
              onChunk({ type: 'text:start', content: '' })
              realTextStartEmitted = true
            }

            onChunk({ type: 'text:done', content: cleanText, data: { text: cleanText } })
            break
          }

          // ===== 停止信号（某些 SDK 版本可能发出）=====
          case 'stop': {
            // 关闭思考流（如果仍在 think 块中）
            if (inThinkBlock) {
              inThinkBlock = false
              onChunk({
                type: 'reasoning:done',
                content: '',
                data: { rawContent: thinkingBuffer }
              })
            }
            // 关闭文本流
            if (textStartEmitted && realTextStartEmitted) {
              const fullText = stripThinkTags(extractFullText(evt.message))
              onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
            }
            break
          }

          // input_json_delta: 工具参数流式，不需要前端展示
          default:
            break
        }
        break
      }

      case 'message_end': {
        // 只为 assistant 消息发出 llm:done
        if (evt.message?.role === 'assistant') {
          // 检测 API 错误（pi-SDK 不 throw，而是将错误记录在 message 中）
          if (evt.message?.stopReason === 'error' || evt.message?.errorMessage) {
            const errorMsg = evt.message.errorMessage || 'Unknown API error'
            log.error(`API error detected: ${errorMsg}`)
            onApiError?.(errorMsg)
          }

          const usage = evt.message?.usage
          onChunk({
            type: 'llm:done',
            content: '',
            data: {
              usage: usage
                ? {
                    inputTokens: usage.input || usage.inputTokens || 0,
                    outputTokens: usage.output || usage.outputTokens || 0,
                    totalTokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0)
                  }
                : undefined
            }
          })
        }
        break
      }

      // ===== Tool（含执行进度！）=====
      case 'tool_execution_start': {
        const toolName = evt.toolName || 'unknown'
        onChunk({
          type: 'tool:start',
          content: toolName,
          data: { toolName, callId: evt.toolCallId }
        })
        break
      }

      case 'tool_execution_update': {
        // OpenAI SDK 完全没有对应事件！pi-SDK 独有。
        onChunk({
          type: 'tool:delta',
          content: JSON.stringify(evt.partialResult),
          data: { delta: JSON.stringify(evt.partialResult), callId: evt.toolCallId }
        })
        break
      }

      case 'tool_execution_end': {
        const toolName = evt.toolName || 'unknown'
        const rawResult = evt.result

        // 从 pi-SDK 的 AgentToolResult 结构中提取纯文本输出
        // 统一为与 OpenAI SDK 一致的格式：纯 JSON 字符串
        const output = extractToolOutput(rawResult)

        // 记录工具调用
        if (toolCalls) {
          toolCalls.push({
            toolName,
            arguments: typeof evt.args === 'object' ? evt.args : {},
            result: output
          })
        }

        onChunk({
          type: 'tool:done',
          content: output,
          data: { toolName, callId: evt.toolCallId, output }
        })
        break
      }

      // ===== 压缩（SDK 内置！）=====
      case 'auto_compaction_start':
        onChunk({
          type: 'compression:start',
          content: `Compaction triggered: ${evt.reason}`,
          data: { reason: evt.reason || 'threshold', totalTokens: 0, threshold: 0 }
        })
        break

      case 'auto_compaction_end':
        onChunk({
          type: 'compression:done',
          content: evt.aborted ? 'Compaction aborted' : 'Compaction done',
          data: {
            summarizedSeqs: [],
            endSeq: 0,
            originalTokens: 0,
            summaryTokens: 0,
            compressionRatio: 0,
            duration: 0
          }
        })
        break

      // ===== 重试（可选日志）=====
      case 'auto_retry_start':
        log.info(
          `Auto retry: attempt ${evt.attempt}/${evt.maxAttempts}, ` +
            `delay ${evt.delayMs}ms, reason: ${evt.errorMessage}`
        )
        break

      case 'auto_retry_end':
        log.info(`Auto retry end: success=${evt.success}, attempt=${evt.attempt}`)
        break

      default:
        break
    }
  })
}

// ========== Utility Functions ==========

/**
 * 从文本中去除 <think>...</think> 标签及其内容
 *
 * OpenAI Chat Completions 格式下，部分 Provider（如 MiniMax）
 * 会将思考内容以 <think>...</think> 标签包裹在文本中返回。
 */
export function stripThinkTags(text: string): string {
  if (!text) return ''
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
}

/**
 * 从 pi-SDK 的 AgentToolResult 中提取纯文本输出
 *
 * pi-SDK 返回结构化的 { content: [{ type: "text", text: "..." }], details: {...} }
 * OpenAI SDK 返回纯 JSON 字符串 "{\"result\":45,...}"
 * 此方法统一为纯字符串格式，与 OpenAI 保持一致。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractToolOutput(result: any): string {
  if (!result) return ''
  if (typeof result === 'string') return result

  // pi-SDK AgentToolResult: { content: [{ type: "text", text: "..." }], details: {...} }
  if (Array.isArray(result.content)) {
    const texts = result.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => c.text)
    if (texts.length > 0) {
      return texts.join('')
    }
  }

  // fallback：序列化整个对象
  return JSON.stringify(result)
}

/**
 * 从 AgentMessage 中提取完整文本
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractFullText(message: any): string {
  if (!message) return ''

  // 尝试从 content 数组提取
  if (Array.isArray(message.content)) {
    return (
      message.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c.type === 'text')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.text || '')
        .join('')
    )
  }

  // 尝试直接取 text 字段
  if (typeof message.text === 'string') {
    return message.text
  }

  return ''
}
