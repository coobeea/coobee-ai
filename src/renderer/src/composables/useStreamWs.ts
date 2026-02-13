/**
 * Stream 领域 WebSocket 组合式
 *
 * 封装 AI 流式频道的所有 WebSocket 交互逻辑：
 *   - 订阅/取消订阅会话的流式事件
 *   - 重连后自动恢复订阅
 *   - 消息分发给消费方（如 chatStore）
 *
 * 消息类型：
 *   发送：stream:subscribe, stream:unsubscribe, stream:resend, stream:latest_sequence
 *   接收：stream:message, stream:resend_batch, stream:latest_sequence
 */

import { wsService } from '@/plugins/wsSetup'
import type { StreamMessage } from '@shared/stream-protocol'

// ==================== 内部状态 ====================

let subscribedSessionId: string | null = null
let messageHandler: ((msg: StreamMessage) => void) | null = null
let unregisterPrefix: (() => void) | null = null
let unregisterConnect: (() => void) | null = null

// ==================== 初始化 ====================

/**
 * 初始化 stream 前缀处理器
 *
 * 在模块加载时自动注册，确保在 wsSetup 连接后即可接收 stream:* 消息。
 */
function init(): void {
  if (unregisterPrefix) return // 已注册

  // 注册 stream:* 消息处理器
  unregisterPrefix = wsService.onPrefix('stream', (action, data) => {
    switch (action) {
      case 'message':
        // 单条流式消息
        if (messageHandler && data) {
          messageHandler(data as StreamMessage)
        }
        break

      case 'resend_batch':
        // 历史消息批量重发
        if (messageHandler && Array.isArray(data)) {
          for (const m of data) {
            messageHandler(m as StreamMessage)
          }
        }
        break

      case 'latest_sequence':
        // 可选：用于断线重连对齐
        break
    }
  })

  // 注册连接回调：重连后自动恢复订阅
  unregisterConnect = wsService.onConnect(() => {
    if (subscribedSessionId) {
      wsService.send({ type: 'stream:subscribe', sessionId: subscribedSessionId })
      console.log(`[useStreamWs] 重连后恢复订阅: ${subscribedSessionId}`)
    }
  })
}

// 模块加载时自动初始化
init()

// ==================== 导出 API ====================

/**
 * 订阅指定 session 的流式事件
 *
 * @param sessionId 会话 ID
 * @param handler   消息回调（由 chatStore 等消费方提供）
 */
export function streamSubscribe(sessionId: string, handler: (msg: StreamMessage) => void): void {
  // 取消之前的订阅
  if (subscribedSessionId && subscribedSessionId !== sessionId) {
    wsService.send({ type: 'stream:unsubscribe', sessionId: subscribedSessionId })
  }

  subscribedSessionId = sessionId
  messageHandler = handler

  // 已连接则立即发送订阅
  if (wsService.connectionState.value === 'connected') {
    wsService.send({ type: 'stream:subscribe', sessionId })
    console.log(`[useStreamWs] 订阅会话: ${sessionId}`)
  }
  // 未连接时，onConnect 回调会在连接后自动恢复
}

/**
 * 取消订阅
 */
export function streamUnsubscribe(): void {
  if (subscribedSessionId) {
    wsService.send({ type: 'stream:unsubscribe', sessionId: subscribedSessionId })
    subscribedSessionId = null
  }
  messageHandler = null
}

/**
 * 请求重发历史消息
 */
export function streamResend(sessionId: string, fromSequence: number): void {
  wsService.send({ type: 'stream:resend', sessionId, fromSequence })
}

/**
 * 请求最新序号
 */
export function streamLatestSequence(sessionId: string): void {
  wsService.send({ type: 'stream:latest_sequence', sessionId })
}

/**
 * 清理资源（通常在应用销毁时调用）
 */
export function streamCleanup(): void {
  streamUnsubscribe()
  unregisterPrefix?.()
  unregisterConnect?.()
  unregisterPrefix = null
  unregisterConnect = null
}
