/**
 * Chat Store
 *
 * 职责：纯聊天数据管理（消息列表、流式消息映射、HITL 审批状态）。
 * 通过 GatewayClient RPC 与后端通信，事件流由 useStreamWs 桥接。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { gateway } from '@/plugins/gatewaySetup'
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs'
import type { StreamMessage } from '@shared/stream-protocol'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

// ==================== 类型定义 ====================

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
  status: 'calling' | 'done' | 'error'
}

/** HITL 待审批工具信息 */
export interface PendingApproval {
  /** 审批项索引 */
  index: number
  /** 工具名称 */
  toolName: string
  /** 工具参数（JSON 字符串） */
  arguments?: string
  /** 用户决策（提交后填入） */
  decision?: HitlApprovalDecision
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
  /** HITL 待审批工具列表 */
  pendingApprovals?: PendingApproval[]
  /** 消息状态 */
  status: 'sending' | 'streaming' | 'done' | 'error' | 'interrupted'
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

      case 'hitl':
        // HITL 审批请求 —— 添加到 pendingApprovals
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        if (msg.data?.action === 'required') {
          if (!assistantMsg.pendingApprovals) {
            assistantMsg.pendingApprovals = []
          }
          assistantMsg.pendingApprovals.push({
            index: (msg.data.index as number) ?? assistantMsg.pendingApprovals.length,
            toolName: (msg.data.toolName as string) || 'unknown',
            arguments: msg.data.arguments as string | undefined
          })
        }
        break

      case 'interrupted':
        // HITL 中断 —— 流暂停，等待审批
        if (assistantMsg) {
          assistantMsg.status = 'interrupted'
        }
        isStreaming.value = false
        break

      case 'resumed':
        // HITL 恢复 —— 审批完成，流继续
        if (assistantMsg) {
          assistantMsg.status = 'streaming'
        }
        isStreaming.value = true
        break

      default:
        // handoff, agent_updated 等暂不处理
        console.log(`[chatStore] Unhandled stream message type: ${msg.type}`, msg)
        break
    }
  }

  // ---- 对外 Actions ----

  /**
   * 发送消息
   * 1. 添加用户消息到列表
   * 2. 通过 Gateway RPC 调用 chat.send 启动 Agent
   * 3. 通过 useStreamWs 订阅流式事件
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
      // 通过 Gateway RPC 调用 chat.send
      const result = await gateway.request<{
        sessionId: string
        status: 'streaming' | 'error'
        error?: string
      }>('chat.send', { message: text, sessionId: sessionId.value })

      if (result) {
        const { sessionId: sid, status, error } = result

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

        // 通过 useStreamWs 订阅流式事件
        streamSubscribe(sid, handleStreamMessage)
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
   * 提交 HITL 审批决策
   *
   * 为指定工具提交决策。当所有工具都提交后，后台自动恢复执行。
   */
  async function submitDecision(
    sid: string,
    index: number,
    decision: HitlApprovalDecision
  ): Promise<void> {
    try {
      const result = await gateway.request<{ ok: boolean; error?: string }>('hitl.decide', {
        sessionId: sid,
        index,
        decision
      })

      if (result?.ok) {
        // 更新本地状态：记录已提交的决策
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg?.pendingApprovals) {
          const approval = lastMsg.pendingApprovals.find((a) => a.index === index)
          if (approval) {
            approval.decision = decision
          }
        }
      } else {
        console.error('[chatStore] submitDecision failed:', result)
      }
    } catch (err: unknown) {
      console.error('[chatStore] submitDecision error:', err)
    }
  }

  /**
   * 清空对话
   */
  function clearMessages(): void {
    messages.value = []
    sessionId.value = null
    isStreaming.value = false
    streamUnsubscribe()
  }

  return {
    // 状态
    sessionId,
    messages,
    isStreaming,

    // Actions
    sendMessage,
    submitDecision,
    clearMessages
  }
})
