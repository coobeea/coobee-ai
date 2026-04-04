/**
 * Chat Store (轻量化版本)
 *
 * 职责：仅管理发送消息、队列、abort 等操作
 * 消息历史由组件本地持有（使用 useStreamHandler），unmounted 时自动释放
 */

import { defineStore } from 'pinia';
import { ref, computed, type ComputedRef } from 'vue';
import configManager from '@/config';
import { gateway } from '@/plugins/gatewaySetup';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

// Re-export shared types
export type {
  StreamChatMessage as ChatMessage,
  ContentBlock,
  ToolCallInfo,
  DelegateInfo,
  PendingApproval,
  MessageStatus,
  ExecOutputEntry
} from '@/composables/useStreamHandler';

// ==================== 类型定义 ====================

/** 队列状态 */
export interface QueueStatusInfo {
  isRunning: boolean;
  queueLength: number;
  mode: string;
}

/** 待发送消息队列项 */
export interface QueuedMessage {
  id: string;
  text: string;
  files?: { path: string; name: string }[];
  timestamp: number;
}

/** 单个 Thread 的流式状态（轻量化：仅队列+流式标识） */
export interface ThreadStreamState {
  isStreaming: boolean; // 流式进行中标识（由组件更新）
  isQueued: boolean;
  queueStatus: QueueStatusInfo | null;
  messageQueue: QueuedMessage[];
  queueCounter: number;
  lastUserMessage: { text: string; files?: { path: string; name: string }[] } | null;
}

// ==================== Store ====================

export const useChatStore = defineStore('chat', () => {
  // ---- 按 threadId 隔离的轻量状态 ----
  const threadStates = ref(new Map<string, ThreadStreamState>());

  /** 创建默认的 Thread 流式状态 */
  function createDefaultState(): ThreadStreamState {
    return {
      isStreaming: false,
      isQueued: false,
      queueStatus: null,
      messageQueue: [],
      queueCounter: 0,
      lastUserMessage: null
    };
  }

  /** 获取或创建 Thread 状态 */
  function getThreadState(threadId: string): ThreadStreamState {
    if (!threadStates.value.has(threadId)) {
      threadStates.value.set(threadId, createDefaultState());
    }
    return threadStates.value.get(threadId)!;
  }

  /** 获取 Thread 状态（响应式计算属性版本，供组件使用） */
  function getState(threadId: string): ComputedRef<ThreadStreamState> {
    return computed(() => getThreadState(threadId));
  }

  /** 清理 Thread 状态 */
  function clearThreadState(threadId: string): void {
    threadStates.value.delete(threadId);
  }

  // ==================== 流式状态更新（由组件调用） ====================

  /**
   * 设置流式状态（由组件在 run:start / run:done 时调用）
   */
  function setStreaming(threadId: string, streaming: boolean): void {
    const state = getThreadState(threadId);
    state.isStreaming = streaming;
    if (!streaming) {
      state.isQueued = false;
      state.queueStatus = null;
    }
  }

  // ==================== 对外 Actions ====================

  /**
   * 发送消息
   */
  async function sendMessage(
    threadId: string,
    text: string,
    files?: { path: string; name: string }[],
    options?: { skillRef?: string }
  ): Promise<void> {
    if (!text.trim()) return;

    const state = getThreadState(threadId);

    // 如果正在处理，加入队列
    if (state.isStreaming) {
      state.messageQueue.push({
        id: `queue-${++state.queueCounter}`,
        text,
        files,
        timestamp: Date.now()
      });
      return;
    }

    // 否则直接发送
    await sendMessageInternal(threadId, text, files, options?.skillRef);
  }

  async function sendMessageInternal(
    threadId: string,
    text: string,
    files?: { path: string; name: string }[],
    skillRef?: string,
    forcedMode?: 'agent' | 'orchestrator' | 'swarm' | 'discussion' | 'quality-loop' | 'delegate'
  ): Promise<void> {
    const state = getThreadState(threadId);

    // 保存最后一条用户消息
    state.lastUserMessage = { text, files };

    // 构建完整消息
    let finalMessage = text;
    if (files && files.length > 0) {
      const filePaths = files.map((f) => `@${f.path}`).join(' ');
      finalMessage = `${text} ${filePaths}`;
    }

    try {
      let agentId: string | undefined;
      try {
        const { useAgentsStore } = await import('./agents');
        const agentsStore = useAgentsStore();
        agentId = agentsStore.selectedAgentId ?? undefined;
      } catch {
        // agents store 未初始化时忽略
      }

      // 从 Thread 获取 mode
      let mode: 'agent' | 'orchestrator' | 'swarm' | 'discussion' | 'quality-loop' | 'delegate' = forcedMode || 'agent';

      if (!forcedMode) {
        try {
          const { useThreadsStore } = await import('./threads');
          const threadsStore = useThreadsStore();
          const thread = threadsStore.threads.find((t) => t.id === threadId);
          if (thread?.agentType) {
            mode = thread.agentType;
          }
        } catch {
          // threads store 未初始化时使用默认值
        }
      }

      const result = await gateway.request<{
        sessionId: string;
        status: string;
        error?: string;
        queuePosition?: number;
      }>('chat.send', {
        message: finalMessage,
        sessionId: threadId, // 使用 threadId 作为 sessionId
        mode,
        ...(agentId ? { agentId } : {}),
        ...(skillRef ? { skillRef } : {})
      });

      if (result) {
        const { status } = result;

        if (status === 'error') {
          // 组件会在 useStreamHandler 中处理错误消息
          return;
        }

        if (status === 'queued' || status === 'merged') {
          state.isQueued = true;
          state.queueStatus = {
            isRunning: true,
            queueLength: result.queuePosition ?? 1,
            mode: status
          };
        } else {
          state.isQueued = false;
        }
      }
    } catch (err: unknown) {
      // 组件会在 useStreamHandler 中处理错误
      console.error('[chatStore] sendMessage error:', err);
    }
  }

  /**
   * 提交 HITL 审批决策
   * Note: 由于 messages 在组件本地，approval 信息需要由组件传入
   */
  async function submitDecision(
    threadId: string,
    index: number,
    decision: HitlApprovalDecision,
    sessionId?: string // 可选的子 sessionId
  ): Promise<void> {
    try {
      const targetSessionId = sessionId || threadId;

      const result = await gateway.request<{ ok: boolean; error?: string }>('hitl.decide', {
        sessionId: targetSessionId,
        index,
        decision
      });

      if (!result?.ok) {
        console.error('[chatStore] submitDecision failed:', result);
      }
    } catch (err: unknown) {
      console.error('[chatStore] submitDecision error:', err);
    }
  }

  /**
   * 中止会话
   */
  async function abortSession(threadId: string): Promise<void> {
    try {
      console.log('[chatStore] abortSession: requesting abort for sessionId:', threadId);
      const result = await gateway.request<{ sessionId: string; aborted: boolean }>('chat.abort', {
        sessionId: threadId
      });
      console.log('[chatStore] abortSession: result:', result);
      const state = getThreadState(threadId);
      state.isStreaming = false;
      state.isQueued = false;
      state.queueStatus = null;
    } catch (err: unknown) {
      console.error('[chatStore] abortSession error:', err);
    }
  }

  /**
   * 清空某个 Thread 的状态（仅队列等）
   */
  function clearMessages(threadId: string): void {
    const state = getThreadState(threadId);
    state.isStreaming = false;
    state.isQueued = false;
    state.queueStatus = null;
    state.messageQueue = [];
  }

  /**
   * 从队列中移除消息
   */
  function removeFromQueue(threadId: string, queueId: string): void {
    const state = getThreadState(threadId);
    state.messageQueue = state.messageQueue.filter((q) => q.id !== queueId);
  }

  /**
   * 加载 Thread 的历史对话（返回消息数组，由组件持有）
   */
  async function loadHistory(threadId: string): Promise<{
    messages: { ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }[];
    userMessages: { content: string; timestamp: number }[];
  }> {
    const BASE = `${configManager.getBaseUrl()}/gateway/threads`;

    try {
      const res = await fetch(`${BASE}/${threadId}/history`);
      if (!res.ok) return { messages: [], userMessages: [] };

      const data = (await res.json()) as {
        events: { ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }[];
        userMessages: { content: string; timestamp: number }[];
      };

      return {
        messages: data.events || [],
        userMessages: data.userMessages || []
      };
    } catch (err: unknown) {
      console.error('[chatStore] loadHistory error:', err);
      return { messages: [], userMessages: [] };
    }
  }

  return {
    threadStates,
    getState,
    getThreadState,
    clearThreadState,
    setStreaming,
    sendMessage,
    abortSession,
    submitDecision,
    clearMessages,
    removeFromQueue,
    loadHistory
  };
});
