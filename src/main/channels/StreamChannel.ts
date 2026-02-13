/**
 * AI 流式频道（Stream Channel）
 *
 * 前缀：stream
 * 职责：
 *   - 监听 EventBus 的 stream:message/start/end/error 事件
 *   - 按 sessionId 将流式消息推送给已订阅的 WebSocket 客户端
 *   - 处理 subscribe/unsubscribe/resend/latest_sequence 等客户端请求
 *
 * 消息类型：
 *   客户端 → 服务端：stream:subscribe, stream:unsubscribe, stream:resend, stream:latest_sequence
 *   服务端 → 客户端：stream:message, stream:resend_batch, stream:latest_sequence
 */

import { eventBus } from '@main/common/eventbus'
import { log } from '@main/common/logger'
import { StreamEventType, type StreamEvent, type StreamMessage } from '@main/ai/streaming/types'
import { streamStore } from '@main/ai/streaming/consumers/StreamStore'
import type { WsChannel, WsHubApi, WsClientMessage, WsServerMessage } from '@shared/stream-protocol'

// ==================== 内部类型 ====================

/** 扩展客户端元数据：添加 sessionIds */
interface StreamClientMeta extends Record<string, unknown> {
  sessionIds: Set<string>
}

// ==================== StreamChannel ====================

class StreamChannelImpl implements WsChannel {
  readonly prefix = 'stream'
  readonly label = 'AI 流式推送'

  private hub!: WsHubApi

  onInit(hub: WsHubApi): void {
    this.hub = hub
    this.registerEventListeners()
    log.info('[StreamChannel] 初始化完成')
  }

  onConnect(_ws: unknown, meta: Record<string, unknown>): void {
    // 为每个客户端初始化 sessionIds
    ;(meta as StreamClientMeta).sessionIds = new Set()
  }

  async onMessage(
    ws: unknown,
    action: string,
    msg: WsClientMessage,
    meta: Record<string, unknown>
  ): Promise<void> {
    const clientMeta = meta as StreamClientMeta

    switch (action) {
      case 'subscribe':
        if (msg.sessionId) {
          clientMeta.sessionIds.add(msg.sessionId)
          log.info(`[StreamChannel] 订阅: ${msg.sessionId}`)

          this.hub.send(ws, {
            type: 'stream:message',
            data: {
              id: 'system',
              sessionId: msg.sessionId,
              sequence: 0,
              type: 'text',
              content: `[Subscribed to ${msg.sessionId}]`,
              timestamp: Date.now(),
              source: { type: 'agent', id: 'system', name: 'System' }
            }
          } satisfies WsServerMessage)
        }
        break

      case 'unsubscribe':
        if (msg.sessionId) {
          clientMeta.sessionIds.delete(msg.sessionId)
          log.info(`[StreamChannel] 取消订阅: ${msg.sessionId}`)
        }
        break

      case 'resend':
        if (msg.sessionId && typeof msg.fromSequence === 'number') {
          const messages = await streamStore.getMessages(msg.sessionId, msg.fromSequence, 100)
          this.hub.send(ws, {
            type: 'stream:resend_batch',
            data: messages
          } satisfies WsServerMessage)
          log.info(`[StreamChannel] 重发 ${messages.length} 条消息`)
        }
        break

      case 'latest_sequence':
        if (msg.sessionId) {
          const latestSeq = await streamStore.getLatestSequence(msg.sessionId)
          this.hub.send(ws, {
            type: 'stream:latest_sequence',
            data: { sequence: latestSeq }
          } satisfies WsServerMessage)
        }
        break

      default:
        log.warn(`[StreamChannel] 未知 action: ${action}`)
    }
  }

  // ==================== EventBus 监听 ====================

  private registerEventListeners(): void {
    eventBus.on(StreamEventType.MESSAGE, (event: StreamEvent) => {
      if (event.message) {
        this.broadcastMessage(event.message)
      }
    })

    eventBus.on(StreamEventType.START, (event: StreamEvent) => {
      log.info(`[StreamChannel] Stream started: ${event.sessionId}`)
    })

    eventBus.on(StreamEventType.END, (event: StreamEvent) => {
      log.info(`[StreamChannel] Stream ended: ${event.sessionId}`)
    })

    eventBus.on(StreamEventType.ERROR, (event: StreamEvent) => {
      log.error(`[StreamChannel] Stream error: ${event.sessionId}`, event.error)
    })

    log.info('[StreamChannel] EventBus 监听已注册')
  }

  /**
   * 按 sessionId 广播流式消息
   */
  private broadcastMessage(message: StreamMessage): void {
    const sentCount = this.hub.broadcastIf(
      { type: 'stream:message', data: message } satisfies WsServerMessage,
      (_ws, meta) => (meta as StreamClientMeta).sessionIds.has(message.sessionId)
    )

    log.info(`[StreamChannel] 广播 ${message.sessionId}#${message.sequence} → ${sentCount} 客户端`)
  }
}

/** 导出单例（供 WsHub 自动发现） */
export const streamChannel = new StreamChannelImpl()
