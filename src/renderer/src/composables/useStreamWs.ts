/**
 * Stream 领域 WebSocket 组合式
 *
 * 封装 AI 流式频道的所有交互逻辑：
 *   - 订阅/取消订阅会话的流式事件（通过 Gateway RPC）
 *   - 重连后自动恢复订阅
 *   - 消息分发给消费方（如 chatStore）
 *
 * RPC 方法：
 *   stream.subscribe   — 订阅会话
 *   stream.unsubscribe — 取消订阅
 *   stream.resend      — 请求重发历史消息
 *   stream.latestSeq   — 请求最新序号
 *
 * 事件：
 *   stream.message       — 单条流式消息
 *   stream.resend_batch  — 历史消息批量重发
 */

import { gateway } from '@/plugins/gatewaySetup'
import type { StreamMessage } from '@shared/stream-protocol'

// ==================== 内部状态 ====================

let subscribedSessionId: string | null = null
let messageHandler: ((msg: StreamMessage) => void) | null = null
let unregisterMessage: (() => void) | null = null
let unregisterBatch: (() => void) | null = null
let unregisterConnect: (() => void) | null = null

/** 已接收到的最新 sequence（用于重连补发） */
let lastReceivedSeq = 0

// ==================== 初始化 ====================

/**
 * 初始化 stream 事件监听
 *
 * 在模块加载时自动注册，确保 Gateway 连接后即可接收 stream.* 事件。
 */
function init(): void {
  if (unregisterMessage) return // 已注册

  // 监听 stream.message 事件
  // Gateway 事件 payload 结构: { sessionId, message: StreamMessage }
  unregisterMessage = gateway.on('stream.message', (payload) => {
    if (!messageHandler || !payload) return
    const data = payload as { sessionId?: string; message?: StreamMessage }
    // 过滤非当前订阅会话的消息（防止快速切换会话时消息串台）
    if (data.sessionId && data.sessionId !== subscribedSessionId) return
    if (data.message) {
      // 追踪最新 sequence（用于重连后补发）
      if (data.message.sequence > lastReceivedSeq) {
        lastReceivedSeq = data.message.sequence
      }
      messageHandler(data.message)
    }
  })

  // 监听 stream.resend_batch 事件
  unregisterBatch = gateway.on('stream.resend_batch', (payload) => {
    if (messageHandler && Array.isArray(payload)) {
      for (const m of payload) {
        messageHandler(m as StreamMessage)
      }
    }
  })

  // 注册连接回调：重连后自动恢复订阅 + 补发断连期间的消息
  unregisterConnect = gateway.onConnect(() => {
    if (subscribedSessionId) {
      const sid = subscribedSessionId
      const fromSeq = lastReceivedSeq
      gateway
        .request('stream.subscribe', { sessionId: sid })
        .then(() => {
          console.log(`[useStreamWs] 重连后恢复订阅: ${sid}`)
          // 补发断连期间丢失的消息
          if (fromSeq > 0 && messageHandler) {
            gateway
              .request('stream.resend', { sessionId: sid, fromSequence: fromSeq + 1 })
              .then((res) => {
                const result = res as { ok?: boolean; messages?: StreamMessage[] }
                if (result.ok && Array.isArray(result.messages) && result.messages.length > 0) {
                  console.log(
                    `[useStreamWs] 补发 ${result.messages.length} 条消息 (from seq ${fromSeq + 1})`
                  )
                  for (const msg of result.messages) {
                    if (msg.sequence > lastReceivedSeq) {
                      lastReceivedSeq = msg.sequence
                    }
                    messageHandler?.(msg)
                  }
                }
              })
              .catch((err) => console.error('[useStreamWs] 补发消息失败:', err))
          }
        })
        .catch((err) => console.error('[useStreamWs] 重连后恢复订阅失败:', err))
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
    gateway
      .request('stream.unsubscribe', { sessionId: subscribedSessionId })
      .catch((err) => console.error('[useStreamWs] 取消订阅失败:', err))
  }

  subscribedSessionId = sessionId
  messageHandler = handler
  lastReceivedSeq = 0

  // 已连接则立即发送订阅
  if (gateway.connectionState.value === 'connected') {
    gateway
      .request('stream.subscribe', { sessionId })
      .then(() => console.log(`[useStreamWs] 订阅会话: ${sessionId}`))
      .catch((err) => console.error('[useStreamWs] 订阅失败:', err))
  }
  // 未连接时，onConnect 回调会在连接后自动恢复
}

/**
 * 取消订阅
 */
export function streamUnsubscribe(): void {
  if (subscribedSessionId) {
    gateway
      .request('stream.unsubscribe', { sessionId: subscribedSessionId })
      .catch((err) => console.error('[useStreamWs] 取消订阅失败:', err))
    subscribedSessionId = null
  }
  messageHandler = null
}

/**
 * 请求重发历史消息
 */
export function streamResend(sessionId: string, fromSequence: number): void {
  gateway
    .request('stream.resend', { sessionId, fromSequence })
    .catch((err) => console.error('[useStreamWs] 重发请求失败:', err))
}

/**
 * 请求最新序号
 */
export function streamLatestSequence(sessionId: string): void {
  gateway
    .request('stream.latestSeq', { sessionId })
    .catch((err) => console.error('[useStreamWs] 获取最新序号失败:', err))
}

/**
 * 清理资源（通常在应用销毁时调用）
 */
export function streamCleanup(): void {
  streamUnsubscribe()
  unregisterMessage?.()
  unregisterBatch?.()
  unregisterConnect?.()
  unregisterMessage = null
  unregisterBatch = null
  unregisterConnect = null
}
