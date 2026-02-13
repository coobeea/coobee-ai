/**
 * GatewayClient — 前端 Gateway RPC 客户端
 *
 * 职责：
 *   1. 管理 WebSocket 连接生命周期（连接、重连、心跳）
 *   2. 发送 RPC 请求并等待响应（Promise 风格，自动匹配 ID）
 *   3. 接收并分发事件推送给注册的监听器
 *
 * 协议格式与后端 Gateway 完全对齐：
 *   - 发送：GatewayRequest { type: 'req', id, method, params }
 *   - 接收：GatewayResponse { type: 'res', id, ok, payload/error }
 *   - 接收：GatewayEvent { type: 'event', event, payload }
 *
 * 替代旧的 wsSetup + useStreamWs + useWorkerWs 组合。
 */

import { ref, type Ref } from 'vue'
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  GatewayOutMessage
} from '@shared/gateway-protocol'
import { GatewayErrorCode } from '@shared/gateway-protocol'
import type { ConnectionState } from '@shared/stream-protocol'

// ==================== 类型定义 ====================

/** 事件监听器 */
export type EventListener = (payload: unknown) => void

/** RPC 请求超时（毫秒） */
const DEFAULT_REQUEST_TIMEOUT = 30_000

/** 重连参数 */
const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30_000
const MAX_RECONNECT_ATTEMPTS = Infinity

/** 待处理的 RPC 请求 */
interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (error: GatewayRpcError) => void
  timer: ReturnType<typeof setTimeout>
}

// ==================== 错误类 ====================

/**
 * Gateway RPC 错误
 *
 * 统一的错误格式，包含错误码和消息。
 */
export class GatewayRpcError extends Error {
  readonly code: GatewayErrorCode

  constructor(code: GatewayErrorCode, message: string) {
    super(message)
    this.name = 'GatewayRpcError'
    this.code = code
  }
}

// ==================== GatewayClient ====================

let requestIdCounter = 0

function generateRequestId(): string {
  requestIdCounter++
  return `gw-${Date.now()}-${requestIdCounter}`
}

export class GatewayClient {
  // ---- 连接状态（响应式） ----
  readonly connectionState: Ref<ConnectionState> = ref('disconnected')
  readonly lastError: Ref<string | null> = ref(null)

  // ---- 内部状态 ----
  private ws: WebSocket | null = null
  private url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private requestTimeout: number

  /** 待处理请求表：id → PendingRequest */
  private pendingRequests = new Map<string, PendingRequest>()
  /** 事件监听器表：event → listener[] */
  private eventListeners = new Map<string, EventListener[]>()
  /** 连接成功回调列表 */
  private connectHandlers: (() => void)[] = []

  constructor(url: string, options?: { requestTimeout?: number }) {
    this.url = url
    this.requestTimeout = options?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT
  }

  // ==================== 连接管理 ====================

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
    ) {
      return
    }

    this.connectionState.value = 'connecting'
    this.lastError.value = null

    try {
      console.log(`[GatewayClient] Connecting to ${this.url} ...`)
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        console.log(`[GatewayClient] Connected to ${this.url}`)
        this.connectionState.value = 'connected'
        this.lastError.value = null
        this.reconnectAttempts = 0

        // 通知连接回调
        for (const handler of this.connectHandlers) {
          try {
            handler()
          } catch (err) {
            console.error('[GatewayClient] Connect handler error:', err)
          }
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as GatewayOutMessage
          this.handleMessage(msg)
        } catch (err) {
          console.error('[GatewayClient] Failed to parse message:', err)
        }
      }

      this.ws.onerror = () => {
        const attempt = this.reconnectAttempts + 1
        console.warn(`[GatewayClient] Connection error (${this.url}), attempt ${attempt}`)
        this.lastError.value = `无法连接 ${this.url}（第 ${attempt} 次）`
      }

      this.ws.onclose = () => {
        console.log(`[GatewayClient] Disconnected`)
        this.connectionState.value = 'disconnected'
        this.ws = null
        // 拒绝所有待处理请求
        this.rejectAllPending('Connection closed')
        this.scheduleReconnect()
      }
    } catch (err) {
      console.error('[GatewayClient] Failed to create WebSocket:', err)
      this.lastError.value = err instanceof Error ? err.message : String(err)
      this.connectionState.value = 'error'
      this.scheduleReconnect()
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.onclose = null // 防止触发重连
      this.ws.close()
      this.ws = null
    }

    this.connectionState.value = 'disconnected'
    this.reconnectAttempts = 0
    this.rejectAllPending('Client disconnected')
  }

  // ==================== RPC 请求 ====================

  /**
   * 发送 RPC 请求并等待响应
   *
   * @param method  方法名（如 'chat.send', 'stream.subscribe'）
   * @param params  方法参数
   * @returns Promise<unknown> — 成功时返回 payload，失败时 reject GatewayRpcError
   *
   * @example
   *   const result = await gateway.request('worker.list')
   *   const data = await gateway.request('chat.send', { message: 'hi', sessionId: 'abc' })
   */
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new GatewayRpcError(GatewayErrorCode.INTERNAL_ERROR, 'WebSocket not connected'))
        return
      }

      const id = generateRequestId()

      // 超时定时器
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new GatewayRpcError(GatewayErrorCode.TIMEOUT, `Request timeout: ${method} (${id})`))
      }, this.requestTimeout)

      // 存储 pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timer
      })

      // 发送请求
      const req: GatewayRequest = {
        type: 'req',
        id,
        method,
        params
      }

      this.ws.send(JSON.stringify(req))
    })
  }

  // ==================== 事件监听 ====================

  /**
   * 注册事件监听器
   *
   * @param event    事件名（如 'stream.message', 'worker.status'）
   * @param listener 回调函数
   * @returns 取消注册的函数
   *
   * @example
   *   const off = gateway.on('stream.message', (payload) => { ... })
   *   // 取消监听
   *   off()
   */
  on(event: string, listener: EventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)

    return () => {
      const listeners = this.eventListeners.get(event)
      if (listeners) {
        const idx = listeners.indexOf(listener)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    }
  }

  /**
   * 注册连接成功回调（含重连）
   *
   * @returns 取消注册的函数
   */
  onConnect(handler: () => void): () => void {
    this.connectHandlers.push(handler)
    return () => {
      const idx = this.connectHandlers.indexOf(handler)
      if (idx >= 0) this.connectHandlers.splice(idx, 1)
    }
  }

  // ==================== 消息处理 ====================

  private handleMessage(msg: GatewayOutMessage): void {
    switch (msg.type) {
      case 'res':
        this.handleResponse(msg as GatewayResponse)
        break
      case 'event':
        this.handleEvent(msg as GatewayEvent)
        break
      default:
        console.warn('[GatewayClient] Unknown message type:', (msg as Record<string, unknown>).type)
    }
  }

  private handleResponse(res: GatewayResponse): void {
    const pending = this.pendingRequests.get(res.id)
    if (!pending) {
      console.warn(`[GatewayClient] No pending request for id: ${res.id}`)
      return
    }

    this.pendingRequests.delete(res.id)
    clearTimeout(pending.timer)

    if (res.ok) {
      pending.resolve(res.payload)
    } else {
      const error = res.error ?? { code: GatewayErrorCode.INTERNAL_ERROR, message: 'Unknown error' }
      pending.reject(new GatewayRpcError(error.code, error.message))
    }
  }

  private handleEvent(event: GatewayEvent): void {
    const listeners = this.eventListeners.get(event.event)
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(event.payload)
        } catch (err) {
          console.error(`[GatewayClient] Event handler error for ${event.event}:`, err)
        }
      }
    }
  }

  // ==================== 重连 ====================

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[GatewayClient] Max reconnect attempts reached')
      this.lastError.value = '重连次数已达上限'
      return
    }

    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    )
    console.log(`[GatewayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /** 拒绝所有待处理请求 */
  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new GatewayRpcError(GatewayErrorCode.INTERNAL_ERROR, reason))
      this.pendingRequests.delete(id)
    }
  }
}
