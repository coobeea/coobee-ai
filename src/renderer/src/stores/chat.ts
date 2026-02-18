/**
 * Chat Store
 *
 * 职责：纯聊天数据管理（消息列表、流式消息映射、HITL 审批状态）。
 * 通过 GatewayClient RPC 与后端通信，事件流由 useStreamWs 桥接。
 *
 * 消息处理逻辑通过 useStreamHandler composable 与 CopilotStore 共享。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useStreamHandler } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

// Re-export shared types for existing consumers
export type {
  StreamChatMessage as ChatMessage,
  ContentBlock,
  ToolCallInfo,
  DelegateInfo,
  PendingApproval,
  MessageStatus
} from '@/composables/useStreamHandler';

// ==================== Store ====================

/** 队列状态 */
export interface QueueStatusInfo {
  isRunning: boolean;
  queueLength: number;
  mode: string;
}

export const useChatStore = defineStore('chat', () => {
  // ---- 共享消息处理 ----
  const { messages, isStreaming, handleStreamMessage, addUserMessage, addErrorMessage, resetAll } = useStreamHandler({
    idPrefix: 'chat',
    maxMessages: 500
  });

  // ---- 独立状态 ----
  const sessionId = ref<string | null>(null);
  const isQueued = ref(false);
  const queueStatus = ref<QueueStatusInfo | null>(null);

  // ---- 对外 Actions ----

  async function sendMessage(text: string): Promise<void> {
    if (!text.trim() || isStreaming.value) return;

    addUserMessage(text);

    try {
      let agentId: string | undefined;
      try {
        const { useAgentsStore } = await import('./agents');
        const agentsStore = useAgentsStore();
        agentId = agentsStore.selectedAgentId ?? undefined;
      } catch {
        // agents store 未初始化时忽略
      }

      const result = await gateway.request<{
        sessionId: string;
        status: string;
        error?: string;
        queuePosition?: number;
      }>('chat.send', {
        message: text,
        sessionId: sessionId.value,
        ...(agentId ? { agentId } : {})
      });

      if (result) {
        const { sessionId: sid, status, error } = result;

        if (status === 'error') {
          addErrorMessage(error || '启动 Agent 失败');
          return;
        }

        sessionId.value = sid;

        if (status === 'queued' || status === 'merged') {
          isQueued.value = true;
          queueStatus.value = {
            isRunning: true,
            queueLength: result.queuePosition ?? 1,
            mode: status
          };
        } else {
          isQueued.value = false;
        }

        streamSubscribe(sid, handleStreamMessage);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addErrorMessage(errMsg);
    }
  }

  /**
   * 提交 HITL 审批决策
   */
  async function submitDecision(sid: string, index: number, decision: HitlApprovalDecision): Promise<void> {
    try {
      const result = await gateway.request<{ ok: boolean; error?: string }>('hitl.decide', {
        sessionId: sid,
        index,
        decision
      });

      if (result?.ok) {
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg?.pendingApprovals) {
          const approval = lastMsg.pendingApprovals.find((a) => a.index === index);
          if (approval) {
            approval.decision = decision;
          }
        }
      } else {
        console.error('[chatStore] submitDecision failed:', result);
      }
    } catch (err: unknown) {
      console.error('[chatStore] submitDecision error:', err);
    }
  }

  async function abortSession(): Promise<void> {
    if (!sessionId.value) return;
    try {
      await gateway.request<{ sessionId: string; aborted: boolean }>('chat.abort', {
        sessionId: sessionId.value
      });
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.status === 'streaming') {
        lastMsg.status = 'interrupted';
      }
      isStreaming.value = false;
      isQueued.value = false;
      queueStatus.value = null;
    } catch (err: unknown) {
      console.error('[chatStore] abortSession error:', err);
    }
  }

  function clearMessages(): void {
    resetAll();
    sessionId.value = null;
    isQueued.value = false;
    queueStatus.value = null;
    streamUnsubscribe();
  }

  return {
    sessionId,
    messages,
    isStreaming,
    isQueued,
    queueStatus,

    sendMessage,
    abortSession,
    submitDecision,
    clearMessages
  };
});
