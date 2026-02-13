/**
 * Gateway Stream 方法组
 *
 * 对应旧 StreamChannel 的客户端请求处理部分。
 * 事件推送部分在 events/StreamBridge.ts 处理。
 *
 * 方法：
 *   stream.subscribe   — 订阅会话流式消息
 *   stream.unsubscribe — 取消订阅
 *   stream.resend      — 重发历史消息
 *   stream.latestSeq   — 获取最新序列号
 */

import { log } from '@main/common/logger'
import { streamStore } from '@main/ai/streaming/consumers/StreamStore'
import type { MethodGroup } from '../protocol'

export const streamMethods: MethodGroup = {
  namespace: 'stream',
  methods: {
    subscribe: async (params, ctx) => {
      const { sessionId } = params as { sessionId?: string }
      if (!sessionId) {
        return { ok: false, error: 'sessionId is required' }
      }

      ctx.meta.subscribedSessions.add(sessionId)
      log.info(`[stream.subscribe] ${ctx.clientId} → ${sessionId}`)
      return { ok: true, sessionId }
    },

    unsubscribe: async (params, ctx) => {
      const { sessionId } = params as { sessionId?: string }
      if (!sessionId) {
        return { ok: false, error: 'sessionId is required' }
      }

      ctx.meta.subscribedSessions.delete(sessionId)
      log.info(`[stream.unsubscribe] ${ctx.clientId} → ${sessionId}`)
      return { ok: true }
    },

    resend: async (params) => {
      const { sessionId, fromSequence } = params as {
        sessionId?: string
        fromSequence?: number
      }
      if (!sessionId || typeof fromSequence !== 'number') {
        return { ok: false, error: 'sessionId and fromSequence are required' }
      }

      const messages = await streamStore.getMessages(sessionId, fromSequence, 100)
      log.info(`[stream.resend] ${sessionId} from #${fromSequence} → ${messages.length} msgs`)
      return { messages }
    },

    latestSeq: async (params) => {
      const { sessionId } = params as { sessionId?: string }
      if (!sessionId) {
        return { ok: false, error: 'sessionId is required' }
      }

      const sequence = await streamStore.getLatestSequence(sessionId)
      return { sequence }
    }
  }
}
