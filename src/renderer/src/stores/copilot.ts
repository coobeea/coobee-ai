/**
 * Copilot Store — 应用管家悬浮对话状态
 *
 * 独立于主 ChatStore，拥有自己的消息列表、会话 ID 和流式订阅。
 * 始终使用 app-copilot Agent，通过 Gateway RPC chat.send 通信。
 *
 * 消息处理逻辑通过 useStreamHandler composable 与 ChatStore 共享，
 * 确保所有消息类型（hitl、delegate 等）在所有对话场景中一致呈现。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useStreamHandler } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

// Re-export shared types for consumers
export type {
  StreamChatMessage,
  ContentBlock,
  ToolCallInfo,
  DelegateInfo,
  PendingApproval,
  MessageStatus
} from '@/composables/useStreamHandler';

// ==================== 常量 ====================

const COPILOT_AGENT_ID = 'app-copilot';

// ==================== Store ====================

export const useCopilotStore = defineStore('copilot', () => {
  // ---- 共享消息处理 ----
  const { messages, isStreaming, handleStreamMessage, addUserMessage, addErrorMessage, resetAll } = useStreamHandler({
    idPrefix: 'copilot',
    maxMessages: 100
  });

  // ---- 独立状态 ----
  const visible = ref(false);
  const sessionId = ref<string | null>(null);
  const bubbleHidden = ref(false);

  // ---- Getters ----
  const hasMessages = computed(() => messages.value.length > 0);

  /** 初始化独立的流式事件监听 */
  function initStreamListener(): void {
    // 统一复用 useStreamWs 进行订阅注册
    // Copilot 不再自行监听和重连，完全委托给 useStreamWs.ts 处理
    // 取消了以前自己的 stream.subscribe 和 stream.message 监听
    if (sessionId.value) {
      streamSubscribe(sessionId.value, handleStreamMessage);
    }
  }

  // ---- Actions ----

  function toggle(): void {
    visible.value = !visible.value;
  }

  function open(): void {
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
  }

  async function sendMessage(text: string): Promise<void> {
    if (!text.trim() || isStreaming.value) return;

    initStreamListener();
    addUserMessage(text);

    try {
      const result = await gateway.request<{
        sessionId: string;
        status: string;
        error?: string;
      }>('chat.send', {
        message: text,
        sessionId: sessionId.value,
        agentId: COPILOT_AGENT_ID
      });

      if (result) {
        if (result.status === 'error') {
          addErrorMessage(result.error || '启动管家失败');
          return;
        }

        const oldSessionId = sessionId.value;
        if (oldSessionId && oldSessionId !== result.sessionId) {
          streamUnsubscribe(oldSessionId);
        }

        sessionId.value = result.sessionId;

        // 使用统一的 streamSubscribe，代替 gateway.request
        streamSubscribe(result.sessionId, handleStreamMessage);
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
      let targetSessionId = sid;
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg?.pendingApprovals) {
        const approval = lastMsg.pendingApprovals.find((a) => a.index === index);
        if (approval?.sessionId) {
          targetSessionId = approval.sessionId;
        }
      }

      const result = await gateway.request<{ ok: boolean; error?: string }>('hitl.decide', {
        sessionId: targetSessionId,
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
        console.error('[copilot] submitDecision failed:', result);
      }
    } catch (err: unknown) {
      console.error('[copilot] submitDecision error:', err);
    }
  }

  async function abort(): Promise<void> {
    if (!sessionId.value) return;
    try {
      await gateway.request('chat.abort', { sessionId: sessionId.value });
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.status === 'streaming') {
        lastMsg.status = 'done';
      }
      isStreaming.value = false;
    } catch (err: unknown) {
      console.error('[copilot] abort error:', err);
    }
  }

  function clearMessages(): void {
    resetAll();
    if (sessionId.value) {
      streamUnsubscribe(sessionId.value);
    }
    sessionId.value = null;
  }

  /**
   * 清理所有监听器，防止内存泄漏
   * 在应用销毁时调用
   */
  function cleanup(): void {
    if (sessionId.value) {
      streamUnsubscribe(sessionId.value);
    }
    // unregisterStream 和 unregisterConnect 已经被重构移除了
  }

  // ---- Actions: Bubble Visibility ----

  /** 隐藏悬浮球（通常在进入 ThreadView 时） */
  function hideBubble(): void {
    bubbleHidden.value = true;
  }

  /** 显示悬浮球（通常在离开 ThreadView 时） */
  function showBubble(): void {
    bubbleHidden.value = false;
  }

  return {
    // State
    visible,
    sessionId,
    messages,
    isStreaming,
    bubbleHidden,
    // Getters
    hasMessages,
    // Actions
    toggle,
    open,
    close,
    sendMessage,
    submitDecision,
    abort,
    clearMessages,
    cleanup,
    hideBubble,
    showBubble
  };
});
