/**
 * WebSocket 广播器（消费者 2：实时推送）
 *
 * 监听 EventBus 的流式事件，按 sessionId 推送到 WebSocket 客户端。
 * 底层 WebSocket 服务由 common/server/WsServer 提供。
 */

import type { WebSocket } from 'ws'
import { Env } from '@main/common/env'
import { eventBus } from '@main/common/eventbus'
import { WsServer, type WsClientMeta } from '@main/common/server/wsServer'
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types'
import { streamStore } from './StreamStore'

/** 广播器端口，可通过 VITE_WS_PORT 环境变量配置，默认 8765 */
const WS_BROADCASTER_PORT = Env.main.wsPort ? parseInt(Env.main.wsPort, 10) : 8765

// ==================== 协议类型 ====================

/** 客户端消息（客户端 → 服务端） */
export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'resend' | 'ping' | 'get_latest_sequence'
  sessionId?: string
  fromSequence?: number
}

/** 服务端消息（服务端 → 客户端） */
export type ServerMessage =
  | { type: 'message'; data: StreamMessage }
  | { type: 'resend_batch'; data: StreamMessage[] }
  | { type: 'pong'; data?: Record<string, never> }
  | { type: 'error'; data: { error: string } }
  | { type: 'latest_sequence'; data: { sequence: number } }

/** 扩展客户端元数据：添加 sessionIds */
interface BroadcasterClientMeta extends WsClientMeta {
  sessionIds: Set<string>
}

// ==================== WebSocketBroadcaster ====================

export class WebSocketBroadcaster {
  private server: WsServer | null = null

  /**
   * 初始化广播器
   */
  initialize(port: number = WS_BROADCASTER_PORT): void {
    if (this.server?.isInitialized) return

    this.server = new WsServer({
      port,
      onConnect: (_ws, meta) => {
        // 为每个客户端初始化 sessionIds
        ;(meta as BroadcasterClientMeta).sessionIds = new Set()
      },
      onMessage: (ws, data, meta) => {
        this.handleClientMessage(ws, data, meta as BroadcasterClientMeta).catch((error) => {
          console.error('[WebSocketBroadcaster] Error handling message:', error)
        })
      }
    })

    this.server.start()
    this.registerEventListeners()
  }

  /**
   * 注册 EventBus 流式事件监听
   */
  private registerEventListeners(): void {
    eventBus.on(StreamEventType.MESSAGE, (event: StreamEvent) => {
      if (event.message) {
        this.broadcastMessage(event.message)
      }
    })

    eventBus.on(StreamEventType.START, (event: StreamEvent) => {
      console.log(`[WebSocketBroadcaster] Stream started: ${event.sessionId}`)
    })

    eventBus.on(StreamEventType.END, (event: StreamEvent) => {
      console.log(`[WebSocketBroadcaster] Stream ended: ${event.sessionId}`)
    })

    eventBus.on(StreamEventType.ERROR, (event: StreamEvent) => {
      console.error(`[WebSocketBroadcaster] Stream error: ${event.sessionId}`, event.error)
    })

    console.log('[WebSocketBroadcaster] Event listeners registered')
  }

  /**
   * 处理客户端消息（业务协议）
   */
  private async handleClientMessage(
    ws: WebSocket,
    data: string,
    meta: BroadcasterClientMeta
  ): Promise<void> {
    try {
      const msg: ClientMessage = JSON.parse(data)

      switch (msg.type) {
        case 'subscribe':
          if (msg.sessionId) {
            meta.sessionIds.add(msg.sessionId)
            console.log(`[WebSocketBroadcaster] Client subscribed to: ${msg.sessionId}`)

            this.server!.send(ws, {
              type: 'message',
              data: {
                id: 'system',
                sessionId: msg.sessionId,
                sequence: 0,
                type: 'text',
                content: `[Subscribed to ${msg.sessionId}]`,
                timestamp: Date.now(),
                source: { type: 'agent', id: 'system', name: 'System' }
              }
            } satisfies ServerMessage)
          }
          break

        case 'unsubscribe':
          if (msg.sessionId) {
            meta.sessionIds.delete(msg.sessionId)
            console.log(`[WebSocketBroadcaster] Client unsubscribed from: ${msg.sessionId}`)
          }
          break

        case 'resend':
          if (msg.sessionId && typeof msg.fromSequence === 'number') {
            const messages = await streamStore.getMessages(msg.sessionId, msg.fromSequence, 100)
            this.server!.send(ws, { type: 'resend_batch', data: messages } satisfies ServerMessage)
            console.log(`[WebSocketBroadcaster] Resent ${messages.length} messages`)
          }
          break

        case 'get_latest_sequence':
          if (msg.sessionId) {
            const latestSeq = await streamStore.getLatestSequence(msg.sessionId)
            this.server!.send(ws, {
              type: 'latest_sequence',
              data: { sequence: latestSeq }
            } satisfies ServerMessage)
          }
          break

        case 'ping':
          this.server!.send(ws, { type: 'pong', data: {} } satisfies ServerMessage)
          break
      }
    } catch (error) {
      console.error('[WebSocketBroadcaster] Error:', error)
      this.server!.send(ws, {
        type: 'error',
        data: { error: error instanceof Error ? error.message : String(error) }
      } satisfies ServerMessage)
    }
  }

  /**
   * 按 sessionId 广播消息
   */
  private broadcastMessage(message: StreamMessage): void {
    if (!this.server) return

    const sentCount = this.server.broadcastIf(
      { type: 'message', data: message } satisfies ServerMessage,
      (_ws, meta) => (meta as BroadcasterClientMeta).sessionIds.has(message.sessionId)
    )

    console.log(
      `[WebSocketBroadcaster] Broadcasted ${message.sessionId}#${message.sequence} to ${sentCount} clients`
    )
  }

  // ---- 统计接口 ----

  getClientCount(): number {
    return this.server?.clientCount ?? 0
  }

  getSessionClientCount(sessionId: string): number {
    let count = 0
    this.server?.forEachClient((_ws, meta) => {
      if ((meta as BroadcasterClientMeta).sessionIds.has(sessionId)) count++
    })
    return count
  }

  getStats(): { totalClients: number; sessions: Record<string, number> } {
    const sessions: Record<string, number> = {}
    this.server?.forEachClient((_ws, meta) => {
      for (const sid of (meta as BroadcasterClientMeta).sessionIds) {
        sessions[sid] = (sessions[sid] || 0) + 1
      }
    })
    return { totalClients: this.server?.clientCount ?? 0, sessions }
  }

  close(): void {
    this.server?.close()
  }
}

/** 全局实例 */
export const webSocketBroadcaster = new WebSocketBroadcaster()
