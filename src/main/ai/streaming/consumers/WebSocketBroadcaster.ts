/**
 * WebSocket 广播器（消费者 2：实时推送）
 * 监听 EventBus 的流式事件，推送到 WebSocket 客户端
 */

import { WebSocketServer, WebSocket } from 'ws'
import { eventBus } from '@main/common/eventbus'
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types'
import { streamStore } from './StreamStore'

/**
 * 客户端消息（客户端 → 服务端）
 */
export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'resend' | 'ping' | 'get_latest_sequence'
  sessionId?: string
  fromSequence?: number
}

/**
 * 服务端消息（服务端 → 客户端）
 */
export type ServerMessage =
  | { type: 'message'; data: StreamMessage }
  | { type: 'resend_batch'; data: StreamMessage[] }
  | { type: 'pong'; data?: Record<string, never> }
  | { type: 'error'; data: { error: string } }
  | { type: 'latest_sequence'; data: { sequence: number } }

/**
 * WebSocket 广播器
 */
export class WebSocketBroadcaster {
  private wss!: WebSocketServer
  private clients = new Map<WebSocket, Set<string>>() // client -> sessionIds
  private initialized = false

  /**
   * 初始化 WebSocket 服务器
   */
  initialize(port: number = 8765): void {
    if (this.initialized) return

    this.wss = new WebSocketServer({ port })
    console.log(`[WebSocketBroadcaster] Server started on port ${port}`)

    this.wss.on('connection', (ws) => {
      console.log('[WebSocketBroadcaster] Client connected')
      this.clients.set(ws, new Set())

      ws.on('message', (data) => {
        this.handleClientMessage(ws, data.toString()).catch((error) => {
          console.error('[WebSocketBroadcaster] Error handling client message:', error)
        })
      })

      ws.on('close', () => {
        console.log('[WebSocketBroadcaster] Client disconnected')
        this.clients.delete(ws)
      })

      ws.on('error', (error) => {
        console.error('[WebSocketBroadcaster] WebSocket error:', error)
      })
    })

    // 注册事件监听器
    this.registerEventListeners()

    this.initialized = true
  }

  /**
   * 注册事件监听器（消费者核心）
   */
  private registerEventListeners(): void {
    // 监听消息事件
    eventBus.on(StreamEventType.MESSAGE, (event: StreamEvent) => {
      if (event.message) {
        this.broadcastMessage(event.message)
      }
    })

    // 监听流开始事件
    eventBus.on(StreamEventType.START, (event: StreamEvent) => {
      console.log(`[WebSocketBroadcaster] Stream started: ${event.sessionId}`)
    })

    // 监听流结束事件
    eventBus.on(StreamEventType.END, (event: StreamEvent) => {
      console.log(`[WebSocketBroadcaster] Stream ended: ${event.sessionId}`)
    })

    // 监听错误事件
    eventBus.on(StreamEventType.ERROR, (event: StreamEvent) => {
      console.error(`[WebSocketBroadcaster] Stream error: ${event.sessionId}`, event.error)
    })

    console.log('[WebSocketBroadcaster] Event listeners registered')
  }

  /**
   * 处理客户端消息
   */
  private async handleClientMessage(ws: WebSocket, data: string): Promise<void> {
    try {
      const msg: ClientMessage = JSON.parse(data)

      switch (msg.type) {
        case 'subscribe':
          // 订阅会话
          if (msg.sessionId) {
            const sessions = this.clients.get(ws)
            sessions?.add(msg.sessionId)
            console.log(`[WebSocketBroadcaster] Client subscribed to: ${msg.sessionId}`)

            // 响应订阅成功
            this.sendToClient(ws, {
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
            })
          }
          break

        case 'unsubscribe':
          // 取消订阅
          if (msg.sessionId) {
            const sessions = this.clients.get(ws)
            sessions?.delete(msg.sessionId)
            console.log(`[WebSocketBroadcaster] Client unsubscribed from: ${msg.sessionId}`)
          }
          break

        case 'resend':
          // 补发消息
          if (msg.sessionId && typeof msg.fromSequence === 'number') {
            console.log(
              `[WebSocketBroadcaster] Resending messages: ${msg.sessionId} from ${msg.fromSequence}`
            )

            const messages = await streamStore.getMessages(msg.sessionId, msg.fromSequence, 100)

            this.sendToClient(ws, {
              type: 'resend_batch',
              data: messages
            })

            console.log(`[WebSocketBroadcaster] Resent ${messages.length} messages`)
          }
          break

        case 'get_latest_sequence':
          // 获取最新序号
          if (msg.sessionId) {
            const latestSeq = await streamStore.getLatestSequence(msg.sessionId)
            this.sendToClient(ws, {
              type: 'latest_sequence',
              data: { sequence: latestSeq }
            })
          }
          break

        case 'ping':
          this.sendToClient(ws, { type: 'pong', data: {} })
          break
      }
    } catch (error) {
      console.error('[WebSocketBroadcaster] Error:', error)
      this.sendToClient(ws, {
        type: 'error',
        data: { error: error instanceof Error ? error.message : String(error) }
      })
    }
  }

  /**
   * 广播消息到订阅的客户端
   */
  private broadcastMessage(message: StreamMessage): void {
    const serverMsg: ServerMessage = {
      type: 'message',
      data: message
    }

    let sentCount = 0

    for (const [ws, sessions] of this.clients) {
      if (sessions.has(message.sessionId) && ws.readyState === WebSocket.OPEN) {
        this.sendToClient(ws, serverMsg)
        sentCount++
      }
    }

    console.log(
      `[WebSocketBroadcaster] Broadcasted message ${message.sessionId}#${message.sequence} to ${sentCount} clients`
    )
  }

  /**
   * 发送消息给单个客户端
   */
  private sendToClient(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * 获取连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * 获取订阅某个会话的客户端数量
   */
  getSessionClientCount(sessionId: string): number {
    let count = 0
    for (const sessions of this.clients.values()) {
      if (sessions.has(sessionId)) count++
    }
    return count
  }

  /**
   * 关闭所有连接
   */
  close(): void {
    for (const ws of this.clients.keys()) {
      ws.close()
    }
    this.clients.clear()
    this.wss?.close()
    console.log('[WebSocketBroadcaster] Closed')
  }
}

/**
 * 全局 WebSocketBroadcaster 实例
 */
export const webSocketBroadcaster = new WebSocketBroadcaster()
