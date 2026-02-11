/**
 * Agent 流式事件 Composable
 *
 * 管理 WebSocket 连接，订阅指定 sessionId 的流式事件。
 * 所有收到的消息分发到 chatStore 统一管理。
 */

import { ref, onUnmounted, type Ref } from 'vue'
import configManager from '@/config'

// ==================== 类型定义 ====================

/** 流式消息类型（与后端 StreamMessageType 对齐） */
export type StreamMessageType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'handoff'
  | 'hitl'
  | 'agent_updated'
  | 'start'
  | 'done'
  | 'error'

/** 流式消息来源 */
export interface StreamSource {
  type: 'agent' | 'team' | 'swarm'
  id: string
  name: string
}

/** 流式消息（与后端 StreamMessage 对齐） */
export interface StreamMessage {
  id: string
  sessionId: string
  sequence: number
  type: StreamMessageType
  content: string
  data?: Record<string, unknown>
  timestamp: number
  source: StreamSource
}

/** 服务端消息格式 */
type ServerMessage =
  | { type: 'message'; data: StreamMessage }
  | { type: 'resend_batch'; data: StreamMessage[] }
  | { type: 'pong'; data?: Record<string, never> }
  | { type: 'error'; data: { error: string } }
  | { type: 'latest_sequence'; data: { sequence: number } }

/** 连接状态 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

// ==================== Composable ====================

/** WebSocket 地址，通过 ConfigManager 统一管理 */
const WS_URL = configManager.getWsUrl()
const RECONNECT_DELAY = 2000
const MAX_RECONNECT_ATTEMPTS = 5

export interface AgentStreamReturn {
  connectionState: Ref<ConnectionState>
  lastError: Ref<string | null>
  connect: () => void
  disconnect: () => void
  subscribe: (sessionId: string, handler: (msg: StreamMessage) => void) => void
  unsubscribe: () => void
}

export function useAgentStream(): AgentStreamReturn {
  const connectionState = ref<ConnectionState>('disconnected')
  const lastError = ref<string | null>(null)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let subscribedSessionId: string | null = null
  let messageHandler: ((msg: StreamMessage) => void) | null = null

  /**
   * 连接 WebSocket 服务器
   */
  function connect(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    connectionState.value = 'connecting'
    lastError.value = null

    try {
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        console.log('[useAgentStream] WebSocket connected')
        connectionState.value = 'connected'
        reconnectAttempts = 0

        // 重连后恢复订阅
        if (subscribedSessionId) {
          sendSubscribe(subscribedSessionId)
        }
      }

      ws.onmessage = (event) => {
        try {
          const serverMsg: ServerMessage = JSON.parse(event.data as string)
          handleServerMessage(serverMsg)
        } catch (err) {
          console.error('[useAgentStream] Failed to parse message:', err)
        }
      }

      ws.onerror = (event) => {
        console.error('[useAgentStream] WebSocket error:', event)
        lastError.value = 'WebSocket 连接错误'
        connectionState.value = 'error'
      }

      ws.onclose = () => {
        console.log('[useAgentStream] WebSocket disconnected')
        connectionState.value = 'disconnected'
        ws = null
        scheduleReconnect()
      }
    } catch (err) {
      console.error('[useAgentStream] Failed to create WebSocket:', err)
      lastError.value = err instanceof Error ? err.message : String(err)
      connectionState.value = 'error'
      scheduleReconnect()
    }
  }

  /**
   * 处理服务端消息
   */
  function handleServerMessage(msg: ServerMessage): void {
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
        console.error('[useAgentStream] Server error:', msg.data?.error)
        lastError.value = msg.data?.error || '未知服务端错误'
        break

      case 'pong':
        // 心跳响应，忽略
        break

      case 'latest_sequence':
        // 可选：用于断线重连对齐
        break
    }
  }

  /**
   * 发送订阅命令
   */
  function sendSubscribe(sessionId: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', sessionId }))
      console.log(`[useAgentStream] Subscribed to session: ${sessionId}`)
    }
  }

  /**
   * 发送取消订阅命令
   */
  function sendUnsubscribe(sessionId: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }))
      console.log(`[useAgentStream] Unsubscribed from session: ${sessionId}`)
    }
  }

  /**
   * 订阅指定 session 的流式事件
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

  /**
   * 调度重连
   */
  function scheduleReconnect(): void {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[useAgentStream] Max reconnect attempts reached')
      lastError.value = '重连次数已达上限'
      return
    }

    if (reconnectTimer) return

    reconnectAttempts++
    const delay = RECONNECT_DELAY * reconnectAttempts
    console.log(`[useAgentStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
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

  // 组件卸载时自动清理
  onUnmounted(() => {
    disconnect()
  })

  return {
    connectionState,
    lastError,
    connect,
    disconnect,
    subscribe,
    unsubscribe
  }
}
