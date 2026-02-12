/**
 * Agent Chat API
 *
 * 极薄入口层 — 只负责解析参数、调用 AgentExecutor。
 * 不管 Runtime 创建、缓存、并发控制，全部委托给 Executor。
 *
 * 两种消费模式：
 *   1. chat()     — POST 触发后台执行，事件通过 WebSocket 推送（推送模式）
 *   2. chatStream() — SSE 直接拉取 AsyncGenerator 流式事件（拉取模式）
 */

import { log } from '@main/common/logger'
import { Post, SSE } from '@main/common/server'
import { agentExecutor } from '@main/ai/AgentExecutor'
import type { StreamChunk } from '@main/ai/runtime/types'

// ==================== 内部辅助 ====================

/** 默认 Chat Agent 指令 */
const CHAT_INSTRUCTIONS = '你是一个友好、专业的 AI 助手。请用中文回答用户的问题。'

/** 生成 session ID */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建 Chat Agent Builder（chat / chatStream 共享配置） */
function createChatBuilder(): ReturnType<typeof agentExecutor.piMono> {
  return agentExecutor
    .piMono()
    .name('chat-agent')
    .instructions(CHAT_INSTRUCTIONS)
    .sessionMode('file')
}

// ==================== API 端点 ====================

export default class AgentChatApi {
  /**
   * 发送消息并启动流式处理（推送模式）
   *
   * 流式事件通过 StreamEmitter → EventBus → WebSocketBroadcaster 推送到前端。
   */
  @Post()
  async chat(
    message: string,
    sessionId?: string
  ): Promise<{
    sessionId: string
    status: 'streaming' | 'busy' | 'error'
    error?: string
  }> {
    const sid = sessionId || generateSessionId()

    log.info(`[AgentChatApi] Chat request: sessionId=${sid}`)

    try {
      const result = agentExecutor.submit({
        sessionId: sid,
        message,
        builder: createChatBuilder()
      })

      if (result.status === 'busy') {
        return { sessionId: sid, status: 'busy', error: '当前会话正在处理中' }
      }

      return { sessionId: sid, status: 'streaming' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentChatApi] Failed: sessionId=${sid}`, error)
      return { sessionId: sid, status: 'error', error: msg }
    }
  }

  /**
   * SSE 流式聊天（拉取模式）
   *
   * 客户端通过 EventSource 连接此端点，直接接收 StreamChunk 事件。
   * 内部透传 agentExecutor.stream() 的 AsyncGenerator。
   */
  @SSE()
  async *chatStream(
    message: string,
    sessionId?: string
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const sid = sessionId || generateSessionId()

    log.info(`[AgentChatApi] SSE stream request: sessionId=${sid}`)

    try {
      yield* agentExecutor.stream({
        sessionId: sid,
        message,
        builder: createChatBuilder()
      })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentChatApi] SSE stream failed: sessionId=${sid}, ${msg}`)
      yield { type: 'run:error' as const, content: msg, data: { message: msg } }
    }
  }
}
