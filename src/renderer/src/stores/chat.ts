/**
 * Chat Store
 *
 * 统一管理对话数据和流式事件。
 * 无论传输通道（WebSocket / IPC），前端都通过此 Store 消费数据。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invokeBackend } from '@/api/request'
import { useAgentStream, type StreamMessage } from '@/composables/useAgentStream'

// ==================== 类型定义 ====================

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
  status: 'calling' | 'done' | 'error'
}

/** 对话消息 */
export interface ChatMessage {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: 'user' | 'assistant'
  /** 文本内容（累积） */
  content: string
  /** 思维链内容（累积） */
  thinking?: string
  /** 工具调用记录 */
  toolCalls?: ToolCallInfo[]
  /** 消息状态 */
  status: 'sending' | 'streaming' | 'done' | 'error'
  /** 错误信息 */
  error?: string
  /** 时间戳 */
  timestamp: number
}

// ==================== Store ====================

export const useChatStore = defineStore('chat', () => {
  // ---- 状态 ----
  const sessionId = ref<string | null>(null)
  const messages = ref<ChatMessage[]>([])
  const isStreaming = ref(false)

  // ---- WebSocket 流管理 ----
  const agentStream = useAgentStream()

  // ---- 计算属性 ----
  const connectionState = computed(() => agentStream.connectionState.value)
  const lastError = computed(() => agentStream.lastError.value)

  // ---- 内部辅助 ----

  /** 获取当前正在构建的助手消息 */
  function getCurrentAssistantMessage(): ChatMessage | undefined {
    const last = messages.value[messages.value.length - 1]
    return last?.role === 'assistant' && last.status === 'streaming' ? last : undefined
  }

  /** 创建新的助手消息占位 */
  function createAssistantMessage(): ChatMessage {
    const msg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      status: 'streaming',
      timestamp: Date.now()
    }
    messages.value.push(msg)
    return msg
  }

  /**
   * 处理流式消息事件
   * 这是 StreamMessage → ChatMessage 的核心映射
   */
  function handleStreamMessage(msg: StreamMessage): void {
    let assistantMsg = getCurrentAssistantMessage()

    switch (msg.type) {
      case 'start':
        // 流开始 —— 创建新的助手消息
        isStreaming.value = true
        if (!assistantMsg) {
          createAssistantMessage()
        }
        break

      case 'text':
        // 文本增量 —— 追加到内容
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        assistantMsg.content += msg.content
        break

      case 'thinking':
        // 思维链增量 —— 追加到 thinking
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        assistantMsg.thinking = (assistantMsg.thinking || '') + msg.content
        break

      case 'tool_call':
        // 工具调用开始
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        if (!assistantMsg.toolCalls) {
          assistantMsg.toolCalls = []
        }
        assistantMsg.toolCalls.push({
          name: (msg.data?.toolName as string) || msg.content,
          arguments: (msg.data?.arguments as string) || '',
          status: 'calling'
        })
        break

      case 'tool_result': {
        // 工具调用结果
        if (assistantMsg?.toolCalls?.length) {
          const lastTool = assistantMsg.toolCalls[assistantMsg.toolCalls.length - 1]
          if (lastTool.status === 'calling') {
            lastTool.result = msg.content
            lastTool.status = 'done'
          }
        }
        break
      }

      case 'done':
        // 流结束
        if (assistantMsg) {
          assistantMsg.status = 'done'
        }
        isStreaming.value = false
        break

      case 'error':
        // 流错误
        if (assistantMsg) {
          assistantMsg.status = 'error'
          assistantMsg.error = msg.content
        } else {
          // 没有助手消息时，创建一个错误消息
          messages.value.push({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '',
            status: 'error',
            error: msg.content,
            timestamp: Date.now()
          })
        }
        isStreaming.value = false
        break

      default:
        // handoff, hitl, agent_updated 等暂不处理
        console.log(`[chatStore] Unhandled stream message type: ${msg.type}`, msg)
        break
    }
  }

  // ---- 对外 Actions ----

  /**
   * 发送消息
   * 1. 添加用户消息到列表
   * 2. 调用后端 API 启动 Agent
   * 3. 订阅 WebSocket 流式事件
   */
  async function sendMessage(text: string): Promise<void> {
    if (!text.trim() || isStreaming.value) return

    // 添加用户消息
    messages.value.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'done',
      timestamp: Date.now()
    })

    try {
      // 调用后端 API
      const result = await invokeBackend<{
        sessionId: string
        status: 'streaming' | 'error'
        error?: string
      }>('/api/chat/agent/chat', text, sessionId.value)

      if (result.data) {
        const { sessionId: sid, status, error } = result.data

        if (status === 'error') {
          messages.value.push({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '',
            status: 'error',
            error: error || '启动 Agent 失败',
            timestamp: Date.now()
          })
          return
        }

        // 更新 sessionId
        sessionId.value = sid

        // 订阅流式事件
        agentStream.subscribe(sid, handleStreamMessage)
      } else {
        // API 调用失败
        messages.value.push({
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: '',
          status: 'error',
          error: result.message || '请求失败',
          timestamp: Date.now()
        })
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '',
        status: 'error',
        error: errMsg,
        timestamp: Date.now()
      })
    }
  }

  /**
   * 清空对话
   */
  function clearMessages(): void {
    messages.value = []
    sessionId.value = null
    isStreaming.value = false
    agentStream.unsubscribe()
  }

  /**
   * 断开流式连接
   */
  function disconnect(): void {
    agentStream.disconnect()
    isStreaming.value = false
  }

  return {
    // 状态
    sessionId,
    messages,
    isStreaming,
    connectionState,
    lastError,

    // Actions
    sendMessage,
    clearMessages,
    disconnect
  }
})
