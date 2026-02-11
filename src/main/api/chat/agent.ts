/**
 * Agent Chat API
 *
 * 极薄入口层 — 只负责解析参数、调用 AgentExecutor。
 * 不管 Runtime 创建、缓存、并发控制，全部委托给 Executor。
 */

import { log } from '@main/common/logger'
import { Post } from '@main/common/server'
import { AgentBuilder } from '@main/ai/AgentBuilder'
import { agentExecutor } from '@main/ai/AgentExecutor'

// ==================== API 端点 ====================

export default class AgentChatApi {
  /**
   * 发送消息并启动流式处理
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
    const sid = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    log.info(`[AgentChatApi] Chat request: sessionId=${sid}`)

    try {
      const result = agentExecutor.submit({
        sessionId: sid,
        message,
        builder: AgentBuilder.piMono()
          .name('chat-agent')
          .instructions('你是一个友好、专业的 AI 助手。请用中文回答用户的问题。')
          .sessionMode('file')
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
}
