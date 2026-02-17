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

/**
 * 内容块 — 按时序排列的助手消息内容单元
 *
 * 解决了旧模型（content/thinking/toolCalls 独立字段）丢失时序的问题。
 * 事件到达时按顺序 push 到 blocks 数组，模板按数组顺序渲染即可保持时序。
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: ToolCallInfo }

/** 对话消息 */
export interface ChatMessage {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: 'user' | 'assistant'
  /** 文本内容（用户消息的原文 / 助手消息的聚合文本） */
  content: string
  /** 按时序排列的内容块（仅助手消息使用） */
  blocks: ContentBlock[]
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

/** 队列状态 */
export interface QueueStatusInfo {
  isRunning: boolean
  queueLength: number
  mode: string
}

export const useChatStore = defineStore('chat', () => {
  // ---- 状态 ----
  const sessionId = ref<string | null>(null)
  const messages = ref<ChatMessage[]>([])
  const isStreaming = ref(false)
  /** 当前消息是否已排队（而非立即执行） */
  const isQueued = ref(false)
  /** 队列状态信息 */
  const queueStatus = ref<QueueStatusInfo | null>(null)

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
      blocks: [],
      status: 'streaming',
      timestamp: Date.now()
    }
    messages.value.push(msg)
    return msg
  }

  /**
   * 处理流式消息事件
   *
   * 这是 StreamMessage → ChatMessage 的核心映射。
   * 使用 blocks 数组维护时序：事件按到达顺序 push，模板按数组顺序渲染。
   */
  function handleStreamMessage(msg: StreamMessage): void {
    let assistantMsg = getCurrentAssistantMessage()

    switch (msg.type) {
      case 'start':
        isStreaming.value = true
        if (!assistantMsg) {
          createAssistantMessage()
        }
        break

      case 'text': {
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        assistantMsg.content += msg.content
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += msg.content
        } else {
          assistantMsg.blocks.push({ type: 'text', text: msg.content })
        }
        break
      }

      case 'thinking': {
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
        if (lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += msg.content
        } else {
          assistantMsg.blocks.push({ type: 'thinking', text: msg.content })
        }
        break
      }

      case 'tool_call': {
        if (!assistantMsg) {
          assistantMsg = createAssistantMessage()
        }
        assistantMsg.blocks.push({
          type: 'tool',
          tool: {
            name: (msg.data?.toolName as string) || msg.content,
            arguments: (msg.data?.arguments as string) || '',
            status: 'calling'
          }
        })
        break
      }

      case 'tool_result': {
        if (assistantMsg) {
          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i]
            if (block.type === 'tool' && block.tool.status === 'calling') {
              block.tool.result = msg.content
              block.tool.status = 'done'
              break
            }
          }
        }
        break
      }

      case 'done':
        if (assistantMsg) {
          assistantMsg.status = 'done'
        }
        isStreaming.value = false
        break

      case 'error':
        if (assistantMsg) {
          assistantMsg.status = 'error'
          assistantMsg.error = msg.content
        } else {
          messages.value.push({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '',
            blocks: [],
            status: 'error',
            error: msg.content,
            timestamp: Date.now()
          })
        }
        isStreaming.value = false
        break

      case 'hitl':
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
        if (assistantMsg) {
          assistantMsg.status = 'interrupted'
        }
        isStreaming.value = false
        break

      case 'resumed':
        if (assistantMsg) {
          assistantMsg.status = 'streaming'
        }
        isStreaming.value = true
        break

      default:
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
      blocks: [],
      status: 'done',
      timestamp: Date.now()
    })

    try {
      // 通过 Gateway RPC 调用 chat.send
      const result = await gateway.request<{
        sessionId: string
        status: string
        error?: string
        queuePosition?: number
      }>('chat.send', { message: text, sessionId: sessionId.value })

      if (result) {
        const { sessionId: sid, status, error } = result

        if (status === 'error') {
          messages.value.push({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '',
            blocks: [],
            status: 'error',
            error: error || '启动 Agent 失败',
            timestamp: Date.now()
          })
          return
        }

        // 更新 sessionId
        sessionId.value = sid

        // 处理管线排队状态
        if (status === 'queued' || status === 'merged') {
          isQueued.value = true
          queueStatus.value = {
            isRunning: true,
            queueLength: result.queuePosition ?? 1,
            mode: status
          }
        } else {
          isQueued.value = false
        }

        // 通过 useStreamWs 订阅流式事件
        streamSubscribe(sid, handleStreamMessage)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '',
        blocks: [],
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
   * 中断当前会话
   */
  async function abortSession(): Promise<void> {
    if (!sessionId.value) return
    try {
      await gateway.request<{ sessionId: string; aborted: boolean }>('chat.abort', {
        sessionId: sessionId.value
      })
      // 中断后更新本地状态
      const lastMsg = messages.value[messages.value.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.status === 'streaming') {
        lastMsg.status = 'interrupted'
      }
      isStreaming.value = false
      isQueued.value = false
      queueStatus.value = null
    } catch (err: unknown) {
      console.error('[chatStore] abortSession error:', err)
    }
  }

  /**
   * 清空对话
   */
  function clearMessages(): void {
    messages.value = []
    sessionId.value = null
    isStreaming.value = false
    isQueued.value = false
    queueStatus.value = null
    streamUnsubscribe()
  }

  return {
    // 状态
    sessionId,
    messages,
    isStreaming,
    isQueued,
    queueStatus,

    // Actions
    sendMessage,
    abortSession,
    submitDecision,
    clearMessages
  }
})
