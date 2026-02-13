/**
 * WebSocket 连接管理插件
 *
 * 职责：管理 WebSocket 连接生命周期（连接、重连、订阅、断开）。
 * 不负责业务数据处理 —— 收到的消息通过 handler 回调分发给消费方（如 chatStore）。
 *
 * 参照 ipcSetup 的模式：
 * - 幂等（重复调用不会创建多余连接）
 * - 通过 Vue Plugin API 在应用启动时自动初始化
 * - 导出单例 wsService 供其他模块按需调用
 */

import type { App } from 'vue'
import { ref, type Ref } from 'vue'
import configManager from '@/config'
import { useLogStore } from '@/stores/log'
import type {
  StreamMessage,
  WsServerMessage,
  ConnectionState,
  WorkerStatusInfo
} from '@shared/stream-protocol'

// ==================== 配置 ====================

const WS_URL = configManager.getWsUrl()
const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30000 // 最大重连间隔 30s
/** 不限重连次数：后端启动可能较慢，前端应持续尝试 */
const MAX_RECONNECT_ATTEMPTS = Infinity

// ==================== WebSocket 服务单例 ====================

/** 连接状态（响应式，供 UI 层绑定） */
const connectionState = ref<ConnectionState>('disconnected')
/** 最近一次错误信息 */
const lastError = ref<string | null>(null)

// ---- 内部状态 ----
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let subscribedSessionId: string | null = null
let messageHandler: ((msg: StreamMessage) => void) | null = null
/** Worker 状态回调列表（多个消费方可同时监听） */
let workerStatusHandlers: ((info: WorkerStatusInfo) => void)[] = []
let isInitialized = false

// ---- 日志（惰性获取，install 之后才可用） ----
let _logStore: ReturnType<typeof useLogStore> | null = null
function getLog(): ReturnType<typeof useLogStore> | null {
  if (!_logStore) {
    try {
      _logStore = useLogStore()
    } catch {
      // Pinia 未就绪时静默降级
    }
  }
  return _logStore
}

// ==================== 核心方法 ====================

/**
 * 建立 WebSocket 连接
 */
function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return
  }

  connectionState.value = 'connecting'
  lastError.value = null

  try {
    console.log(`[wsSetup] Connecting to ${WS_URL} ...`)
    getLog()?.debug('system', `WebSocket 正在连接 ${WS_URL}`)
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log(`[wsSetup] Connected to ${WS_URL}`)
      connectionState.value = 'connected'
      lastError.value = null
      const attempts = reconnectAttempts
      reconnectAttempts = 0

      getLog()?.info('system', `WebSocket 已连接 ${WS_URL}`, {
        reconnectAttempts: attempts
      })

      // 重连后恢复订阅
      if (subscribedSessionId) {
        sendSubscribe(subscribedSessionId)
      }

      // 连接后请求 Worker 状态列表
      sendRaw({ type: 'get_workers' })
    }

    ws.onmessage = (event) => {
      try {
        const serverMsg: WsServerMessage = JSON.parse(event.data as string)
        handleServerMessage(serverMsg)
      } catch (err) {
        console.error('[wsSetup] Failed to parse message:', err)
        getLog()?.error('system', `WebSocket 消息解析失败: ${err}`)
      }
    }

    ws.onerror = () => {
      // onerror 后一定会触发 onclose，由 onclose 统一处理重连
      // 此处仅记录错误信息供 UI 显示
      const attempt = reconnectAttempts + 1
      console.warn(`[wsSetup] Connection error (${WS_URL}), attempt ${attempt}`)
      lastError.value = `无法连接 ${WS_URL}（第 ${attempt} 次）`

      getLog()?.warn('system', `WebSocket 连接失败 ${WS_URL}（第 ${attempt} 次）`)
    }

    ws.onclose = (event) => {
      console.log(`[wsSetup] Disconnected (code: ${event.code}, reason: ${event.reason || 'N/A'})`)
      connectionState.value = 'disconnected'
      ws = null

      getLog()?.info('system', `WebSocket 断开连接`, {
        code: event.code,
        reason: event.reason || 'N/A'
      })

      scheduleReconnect()
    }
  } catch (err) {
    console.error('[wsSetup] Failed to create WebSocket:', err)
    lastError.value = err instanceof Error ? err.message : String(err)
    connectionState.value = 'error'

    getLog()?.error('system', `WebSocket 创建失败: ${err}`)

    scheduleReconnect()
  }
}

/**
 * 断开连接
 */
function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (ws) {
    ws.onclose = null // 防止触发重连
    ws.close()
    ws = null
  }

  subscribedSessionId = null
  messageHandler = null
  connectionState.value = 'disconnected'
  reconnectAttempts = 0
}

/**
 * 订阅指定 session 的流式事件
 *
 * @param sessionId 会话 ID
 * @param handler   消息回调（由消费方如 chatStore 提供）
 */
function subscribe(sessionId: string, handler: (msg: StreamMessage) => void): void {
  // 取消之前的订阅
  if (subscribedSessionId && subscribedSessionId !== sessionId) {
    sendUnsubscribe(subscribedSessionId)
  }

  subscribedSessionId = sessionId
  messageHandler = handler

  // 确保已连接
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connect()
  } else {
    sendSubscribe(sessionId)
  }
}

/**
 * 取消订阅
 */
function unsubscribe(): void {
  if (subscribedSessionId) {
    sendUnsubscribe(subscribedSessionId)
    subscribedSessionId = null
  }
  messageHandler = null
}

// ==================== 内部辅助 ====================

function handleServerMessage(msg: WsServerMessage): void {
  switch (msg.type) {
    case 'message':
      if (messageHandler && msg.data) {
        messageHandler(msg.data)
      }
      break

    case 'resend_batch':
      if (messageHandler && Array.isArray(msg.data)) {
        for (const m of msg.data) {
          messageHandler(m)
        }
      }
      break

    case 'error':
      console.error('[wsSetup] Server error:', msg.data?.error)
      lastError.value = msg.data?.error || '未知服务端错误'
      getLog()?.error('system', `WebSocket 服务端错误: ${msg.data?.error || '未知'}`)
      break

    case 'worker_status':
      // 单个 Worker 状态变更
      if (msg.data) {
        for (const handler of workerStatusHandlers) {
          handler(msg.data)
        }
      }
      break

    case 'workers_list':
      // Worker 列表（连接后一次性返回所有 Worker 状态）
      if (Array.isArray(msg.data)) {
        for (const info of msg.data) {
          for (const handler of workerStatusHandlers) {
            handler(info)
          }
        }
      }
      break

    case 'pong':
      // 心跳响应，忽略
      break

    case 'latest_sequence':
      // 可选：用于断线重连对齐
      break
  }
}

function sendRaw(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendSubscribe(sessionId: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', sessionId }))
    console.log(`[wsSetup] Subscribed to session: ${sessionId}`)
    getLog()?.info('system', `WebSocket 订阅会话: ${sessionId}`)
  }
}

function sendUnsubscribe(sessionId: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }))
    console.log(`[wsSetup] Unsubscribed from session: ${sessionId}`)
    getLog()?.info('system', `WebSocket 取消订阅: ${sessionId}`)
  }
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[wsSetup] Max reconnect attempts reached')
    lastError.value = '重连次数已达上限'
    getLog()?.error('system', 'WebSocket 重连次数已达上限')
    return
  }

  if (reconnectTimer) return

  reconnectAttempts++
  // 指数退避：2s → 4s → 8s → 16s → 30s(cap)
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1),
    RECONNECT_MAX_DELAY
  )
  console.log(`[wsSetup] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)
  getLog()?.debug('system', `WebSocket 将在 ${delay}ms 后重连（第 ${reconnectAttempts} 次）`)

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

// ==================== 导出单例服务 ====================

/**
 * WebSocket 服务单例
 *
 * 供 chatStore、ChatPanel 等模块导入使用：
 * - wsService.subscribe(sessionId, handler)  — chatStore 发起订阅
 * - wsService.connectionState                — ChatPanel 绑定连接状态
 */
/**
 * 注册 Worker 状态变更回调
 *
 * @returns 取消注册的函数
 */
function onWorkerStatus(handler: (info: WorkerStatusInfo) => void): () => void {
  workerStatusHandlers.push(handler)
  return () => {
    workerStatusHandlers = workerStatusHandlers.filter((h) => h !== handler)
  }
}

export const wsService = {
  /** 连接状态（响应式） */
  connectionState: connectionState as Ref<ConnectionState>,
  /** 最近一次错误 */
  lastError: lastError as Ref<string | null>,
  /** 建立连接 */
  connect,
  /** 断开连接 */
  disconnect,
  /** 订阅 session 流式事件 */
  subscribe,
  /** 取消订阅 */
  unsubscribe,
  /** 注册 Worker 状态监听 */
  onWorkerStatus,
  /** 启动指定 Worker */
  startWorker: (name: string) => sendRaw({ type: 'start_worker', workerName: name }),
  /** 停止指定 Worker */
  stopWorker: (name: string) => sendRaw({ type: 'stop_worker', workerName: name }),
  /** 主动请求 Worker 状态列表 */
  requestWorkers: () => sendRaw({ type: 'get_workers' })
}

// ==================== Vue Plugin ====================

/**
 * WebSocket 初始化插件
 *
 * 应用启动时自动建立连接，确保流式通道就绪。
 */
export default {
  install(_app: App): void {
    if (isInitialized) {
      console.warn('[wsSetup] Already initialized')
      return
    }

    connect()
    isInitialized = true
    console.log('[wsSetup] WebSocket connection initiated')
    getLog()?.info('system', `WebSocket 插件已初始化，目标地址: ${WS_URL}`)
  }
}
