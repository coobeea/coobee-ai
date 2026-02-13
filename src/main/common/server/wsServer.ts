/**
 * WebSocket 基础服务
 *
 * 提供 WebSocket 连接管理、心跳检测、客户端追踪、消息收发。
 * 业务逻辑通过 onMessage 回调注入，不依赖任何业务模块。
 *
 * 挂载方式：附加到已有 http.Server（通过 HTTP Upgrade 共享端口）。
 */

import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { log } from '@main/common/logger'

// ==================== 类型定义 ====================

/** 客户端元数据（业务层可扩展） */
export interface WsClientMeta {
  /** 连接是否存活（心跳检测用） */
  isAlive: boolean
  /** 心跳定时器 */
  heartbeatTimer: NodeJS.Timeout | null
  /** 业务层自定义数据 */
  [key: string]: unknown
}

/** 消息处理回调 */
export type WsMessageHandler = (
  ws: WebSocket,
  data: string,
  meta: WsClientMeta
) => void | Promise<void>

/** 连接事件回调 */
export type WsConnectionHandler = (ws: WebSocket, meta: WsClientMeta) => void

/** WsServer 配置 */
export interface WsServerOptions {
  /** 附加到的 HTTP Server（通过 HTTP Upgrade 共享端口） */
  server: HttpServer
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval?: number
  /** 客户端消息处理 */
  onMessage?: WsMessageHandler
  /** 客户端连接 */
  onConnect?: WsConnectionHandler
  /** 客户端断开 */
  onDisconnect?: WsConnectionHandler
}

// ==================== WsServer ====================

export class WsServer {
  private wss!: WebSocketServer
  private clients = new Map<WebSocket, WsClientMeta>()
  private initialized = false
  private heartbeatInterval: number
  private onMessage?: WsMessageHandler
  private onConnect?: WsConnectionHandler
  private onDisconnect?: WsConnectionHandler

  constructor(private options: WsServerOptions) {
    this.heartbeatInterval = options.heartbeatInterval ?? 30000
    this.onMessage = options.onMessage
    this.onConnect = options.onConnect
    this.onDisconnect = options.onDisconnect
  }

  /** 启动服务（挂载到已有 HTTP Server） */
  start(): void {
    if (this.initialized) return

    this.wss = new WebSocketServer({ server: this.options.server })
    log.info('[WsServer] Attached to HTTP server (shared port)')

    this.wss.on('connection', (ws) => {
      const meta: WsClientMeta = { isAlive: true, heartbeatTimer: null }
      this.clients.set(ws, meta)
      this.startHeartbeat(ws, meta)

      log.info(`[WsServer] Client connected (total: ${this.clients.size})`)
      this.onConnect?.(ws, meta)

      ws.on('pong', () => {
        meta.isAlive = true
      })

      ws.on('message', (data) => {
        try {
          this.onMessage?.(ws, data.toString(), meta)
        } catch (error) {
          log.error('[WsServer] Error handling message:', error)
        }
      })

      ws.on('close', () => {
        this.onDisconnect?.(ws, meta)
        this.cleanupClient(ws)
        log.info(`[WsServer] Client disconnected (total: ${this.clients.size})`)
      })

      ws.on('error', (error) => {
        log.error('[WsServer] Client error:', error)
        this.onDisconnect?.(ws, meta)
        this.cleanupClient(ws)
      })
    })

    this.initialized = true
  }

  /** 向单个客户端发送 JSON */
  send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }

  /** 向所有客户端广播 JSON */
  broadcast(payload: unknown): void {
    const msg = JSON.stringify(payload)
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg)
      }
    }
  }

  /** 按条件广播（回调返回 true 的客户端） */
  broadcastIf(payload: unknown, predicate: (ws: WebSocket, meta: WsClientMeta) => boolean): number {
    const msg = JSON.stringify(payload)
    let count = 0
    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && predicate(ws, meta)) {
        ws.send(msg)
        count++
      }
    }
    return count
  }

  /** 获取客户端元数据 */
  getClientMeta(ws: WebSocket): WsClientMeta | undefined {
    return this.clients.get(ws)
  }

  /** 遍历所有客户端 */
  forEachClient(callback: (ws: WebSocket, meta: WsClientMeta) => void): void {
    for (const [ws, meta] of this.clients) {
      callback(ws, meta)
    }
  }

  /** 连接数 */
  get clientCount(): number {
    return this.clients.size
  }

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.initialized
  }

  /** 关闭服务 */
  close(): void {
    for (const [ws, meta] of this.clients) {
      if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer)
      ws.close()
    }
    this.clients.clear()
    this.wss?.close()
    this.initialized = false
    log.info('[WsServer] Closed')
  }

  // ---- 内部方法 ----

  private startHeartbeat(ws: WebSocket, meta: WsClientMeta): void {
    meta.heartbeatTimer = setInterval(() => {
      if (!meta.isAlive) {
        log.info('[WsServer] Client heartbeat timeout')
        ws.terminate()
        this.cleanupClient(ws)
        return
      }
      meta.isAlive = false
      ws.ping()
    }, this.heartbeatInterval)
  }

  private cleanupClient(ws: WebSocket): void {
    const meta = this.clients.get(ws)
    if (meta?.heartbeatTimer) {
      clearInterval(meta.heartbeatTimer)
      meta.heartbeatTimer = null
    }
    this.clients.delete(ws)
  }
}
