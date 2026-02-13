/**
 * Gateway Chat 方法组
 *
 * 对应旧 api/chat/agent.ts 的推送模式（chat 方法）。
 * SSE 流式模式暂不迁移（仍通过 HTTP API 层提供）。
 *
 * 方法：
 *   chat.send  — 发送消息并启动流式处理
 *   chat.abort — 中止当前会话（预留）
 */

import { log } from '@main/common/logger'
import { agentExecutor } from '@main/ai/AgentExecutor'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'

/** 默认 Chat Agent 指令 */
const CHAT_INSTRUCTIONS = '你是一个友好、专业的 AI 助手。请用中文回答用户的问题。'

/** 生成 session ID */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建 Chat Agent Builder */
function createChatBuilder(): ReturnType<typeof agentExecutor.piMono> {
  return agentExecutor
    .piMono()
    .name('chat-agent')
    .instructions(CHAT_INSTRUCTIONS)
    .sessionMode('file')
}

export const chatMethods: MethodGroup = {
  namespace: 'chat',
  methods: {
    send: async (params) => {
      const { message, sessionId } = params as { message?: string; sessionId?: string }

      if (!message) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required')
      }

      const sid = sessionId || generateSessionId()
      log.info(`[chat.send] sessionId=${sid}`)

      try {
        const result = agentExecutor.submit({
          sessionId: sid,
          message,
          builder: createChatBuilder()
        })

        if (result.status === 'busy') {
          throw new GatewayMethodError(GatewayErrorCode.SESSION_BUSY, '当前会话正在处理中')
        }

        return { sessionId: sid, status: 'streaming' }
      } catch (error) {
        if (error instanceof GatewayMethodError) throw error
        const msg = error instanceof Error ? error.message : String(error)
        log.error(`[chat.send] Failed: sessionId=${sid}`, error)
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg)
      }
    }
  }
}
