/**
 * Agent Chat API
 *
 * 提供单 Agent 对话接口。
 * 前端发送消息，后端创建/复用 PiMonoAgentRuntime 并启动流式处理。
 * 流式事件通过 StreamEmitter → EventBus → WebSocketBroadcaster 推送到前端。
 */

import { log } from '@main/common/logger'
import { Post } from '@main/common/server'
import { PiMonoAgentRuntime } from '@main/ai/runtime/pimono'

// ==================== Runtime 缓存 ====================

/** 按 sessionId 缓存 Runtime 实例，支持多轮对话 */
const runtimeCache = new Map<string, PiMonoAgentRuntime>()

/**
 * 获取或创建 Runtime 实例
 */
async function getOrCreateRuntime(sessionId: string): Promise<PiMonoAgentRuntime> {
  const existing = runtimeCache.get(sessionId)
  if (existing) {
    return existing
  }

  const apiKey = process.env.VITE_MINIMAX_API_KEY
  if (!apiKey) {
    throw new Error('VITE_MINIMAX_API_KEY 环境变量未配置')
  }

  const runtime = new PiMonoAgentRuntime({
    name: 'chat-agent',
    model: process.env.VITE_MINIMAX_MODEL || 'MiniMax-M2.1',
    apiKey,
    baseURL: process.env.VITE_MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
    sessionId,
    sessionMode: 'file',
    instructions: '你是一个友好、专业的 AI 助手。请用中文回答用户的问题。'
  })

  await runtime.initialize()

  runtimeCache.set(sessionId, runtime)
  log.info(`[AgentChatApi] Runtime created for session: ${sessionId}`)

  return runtime
}

// ==================== API 端点 ====================

export default class AgentChatApi {
  /**
   * 发送消息并启动流式处理
   *
   * 返回 sessionId 后，流式事件通过 WebSocket 推送。
   * 前端应在调用此接口前先通过 WebSocket 订阅对应 sessionId。
   */
  @Post()
  async chat(
    message: string,
    sessionId?: string
  ): Promise<{
    sessionId: string
    status: 'streaming' | 'error'
    error?: string
  }> {
    const sid = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    log.info(`[AgentChatApi] Chat request: sessionId=${sid}, message="${message.slice(0, 50)}..."`)

    try {
      const runtime = await getOrCreateRuntime(sid)

      // 启动流式处理（后台运行，不阻塞响应）
      // StreamEmitter 会自动将事件推送到 EventBus → WebSocketBroadcaster
      runtime
        .runStream(message, {}, () => {
          // onChunk 回调 —— 此处不需要处理，事件由 StreamEmitter 管道分发
        })
        .then((result) => {
          log.info(
            `[AgentChatApi] Stream completed: sessionId=${sid}, duration=${result.duration}ms`
          )
        })
        .catch((error: unknown) => {
          log.error(`[AgentChatApi] Stream error: sessionId=${sid}`, error)
        })

      return { sessionId: sid, status: 'streaming' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentChatApi] Failed to start chat: sessionId=${sid}`, error)
      return { sessionId: sid, status: 'error', error: msg }
    }
  }
}
