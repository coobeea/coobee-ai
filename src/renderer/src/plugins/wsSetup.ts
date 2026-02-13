/**
 * WebSocket 通用传输层（wsSetup）
 *
 * 职责：管理 WebSocket 连接生命周期（连接、重连、心跳、断开）。
 * 不包含任何业务逻辑 —— 收到的消息按前缀路由到注册的处理器。
 *
 * 消息路由机制（镜像后端 WsHub 设计）：
 *   - 业务模块通过 wsService.onPrefix('stream', handler) 注册处理器
 *   - 收到 stream:message 时，自动路由到 'stream' 处理器，action='message'
 *   - 无前缀消息（pong/error）由 wsSetup 自身处理
 *
 * 设计原则：
 *   - 约定大于配置：前缀路由自动分发
 *   - 领域隔离：业务逻辑封装在各自的 composable 中（useStreamWs、useWorkerWs）
 *   - 通用层不依赖任何业务类型
 */

import type { App } from 'vue'
import { ref, type Ref } from 'vue'
import configManager from '@/config'
import { useLogStore } from '@/stores/log'
import type { ConnectionState } from '@shared/stream-protocol'

// ==================== 配置 ====================

const WS_URL = configManager.getWsUrl()
const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30000 // 最大重连间隔 30s
/** 不限重连次数：后端启动可能较慢，前端应持续尝试 */
const MAX_RECONNECT_ATTEMPTS = Infinity

// ==================== 类型定义 ====================

/**
 * 前缀消息处理器
 *
 * @param action  去除前缀后的动作（如 'message'、'status'）
 * @param data    消息的 data 字段（原始 JSON）
 * @param rawMsg  完整原始消息（备用）
 */
export type PrefixHandler = (action: string, data: unknown, rawMsg: Record<string, unknown>) => void

/** 连接事件处理器 */
export type ConnectHandler = () => void

// ==================== 内部状态 ====================

/** 连接状态（响应式，供 UI 层绑定） */
const connectionState = ref<ConnectionState>('disconnected')
/** 最近一次错误信息 */
const lastError = ref<string | null>(null)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let isInitialized = false

/** 前缀路由表：prefix → handler[] */
const prefixHandlers = new Map<string, PrefixHandler[]>()
/** 连接成功回调列表 */
const connectHandlers: ConnectHandler[] = []

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

      // 通知所有连接回调（业务模块可在此恢复订阅等状态）
      for (const handler of connectHandlers) {
        try {
          handler()
        } catch (err) {
          console.error('[wsSetup] Connect handler error:', err)
        }
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>
        handleServerMessage(msg)
      } catch (err) {
        console.error('[wsSetup] Failed to parse message:', err)
        getLog()?.error('system', `WebSocket 消息解析失败: ${err}`)
      }
    }

    ws.onerror = () => {
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

  connectionState.value = 'disconnected'
  reconnectAttempts = 0
}

/**
 * 发送原始消息（通用）
 *
 * 业务模块通过此方法向后端发送消息。
 * 格式：{ type: 'prefix:action', ...payload }
 */
function send(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// ==================== 消息路由 ====================

/**
 * 处理服务端消息
 *
 * 路由逻辑（镜像后端 WsHub）：
 * 1. 解析 msg.type，提取 prefix 和 action
 * 2. 无前缀（pong/error）由 wsSetup 自身处理
 * 3. 有前缀（stream:message）路由到注册的 PrefixHandler
 */
function handleServerMessage(msg: Record<string, unknown>): void {
  const type = msg.type as string
  if (!type) return

  const { prefix, action } = parseType(type)

  // 无前缀 → 内置处理
  if (!prefix) {
    handleBuiltinMessage(action, msg)
    return
  }

  // 按前缀路由到注册的处理器
  const handlers = prefixHandlers.get(prefix)
  if (handlers && handlers.length > 0) {
    for (const handler of handlers) {
      try {
        handler(action, msg.data, msg)
      } catch (err) {
        console.error(`[wsSetup] Handler error for ${type}:`, err)
      }
    }
  } else {
    console.warn(`[wsSetup] No handler registered for prefix: ${prefix} (type: ${type})`)
  }
}

/**
 * 处理内置消息（无前缀）
 */
function handleBuiltinMessage(action: string, msg: Record<string, unknown>): void {
  switch (action) {
    case 'pong':
      // 心跳响应，忽略
      break
    case 'error': {
      const data = msg.data as { error?: string } | undefined
      const errorMsg = data?.error || '未知服务端错误'
      console.error('[wsSetup] Server error:', errorMsg)
      lastError.value = errorMsg
      getLog()?.error('system', `WebSocket 服务端错误: ${errorMsg}`)
      break
    }
    default:
      console.warn(`[wsSetup] Unknown builtin message: ${action}`)
  }
}

/**
 * 解析消息类型：提取 prefix 和 action
 *
 * 'stream:message' → { prefix: 'stream', action: 'message' }
 * 'pong'           → { prefix: null, action: 'pong' }
 */
function parseType(type: string): { prefix: string | null; action: string } {
  const colonIndex = type.indexOf(':')
  if (colonIndex === -1) {
    return { prefix: null, action: type }
  }
  return {
    prefix: type.substring(0, colonIndex),
    action: type.substring(colonIndex + 1)
  }
}

// ==================== 重连 ====================

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[wsSetup] Max reconnect attempts reached')
    lastError.value = '重连次数已达上限'
    getLog()?.error('system', 'WebSocket 重连次数已达上限')
    return
  }

  if (reconnectTimer) return

  reconnectAttempts++
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
 * WebSocket 通用传输服务
 *
 * 仅提供连接管理和消息路由，不包含任何业务逻辑。
 * 业务逻辑请使用对应的领域模块（useStreamWs、useWorkerWs）。
 */
export const wsService = {
  /** 连接状态（响应式） */
  connectionState: connectionState as Ref<ConnectionState>,
  /** 最近一次错误 */
  lastError: lastError as Ref<string | null>,
  /** 建立连接 */
  connect,
  /** 断开连接 */
  disconnect,
  /** 发送消息（通用） */
  send,

  /**
   * 注册前缀消息处理器
   *
   * 业务模块通过此方法注册对特定前缀消息的处理。
   * 如：onPrefix('stream', handler) 将处理所有 stream:* 消息。
   *
   * @param prefix  消息前缀（如 'stream'、'worker'）
   * @param handler 处理器
   * @returns 取消注册的函数
   */
  onPrefix(prefix: string, handler: PrefixHandler): () => void {
    if (!prefixHandlers.has(prefix)) {
      prefixHandlers.set(prefix, [])
    }
    prefixHandlers.get(prefix)!.push(handler)

    return () => {
      const handlers = prefixHandlers.get(prefix)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    }
  },

  /**
   * 注册连接成功回调
   *
   * 业务模块可在连接成功（包括重连）时恢复状态（如重新订阅）。
   *
   * @returns 取消注册的函数
   */
  onConnect(handler: ConnectHandler): () => void {
    connectHandlers.push(handler)
    return () => {
      const idx = connectHandlers.indexOf(handler)
      if (idx >= 0) connectHandlers.splice(idx, 1)
    }
  }
}

// ==================== Vue Plugin ====================

/**
 * WebSocket 初始化插件
 *
 * 应用启动时自动建立连接，确保通道就绪。
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
