/**
 * Chat Store
 *
 * 职责：纯聊天数据管理（消息列表、流式消息映射、HITL 审批状态）。
 * 通过 GatewayClient RPC 与后端通信，事件流由 useStreamWs 桥接。
 *
 * 消息处理逻辑通过 useStreamHandler composable 与 CopilotStore 共享。
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import configManager from '@/config';
import { gateway } from '@/plugins/gatewaySetup';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useStreamHandler, type StreamChatMessage } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

// Re-export shared types for existing consumers
export type {
  StreamChatMessage as ChatMessage,
  ContentBlock,
  ToolCallInfo,
  DelegateInfo,
  PendingApproval,
  MessageStatus,
  ExecOutputEntry
} from '@/composables/useStreamHandler';

// ==================== Store ====================

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

export const useChatStore = defineStore('chat', () => {
  // ---- 共享消息处理 ----
  const { messages, isStreaming, execOutputs, handleStreamMessage, addUserMessage, addErrorMessage, resetAll } =
    useStreamHandler({
      idPrefix: 'chat',
      maxMessages: 500
    });

  // ---- 独立状态 ----
  const sessionId = ref<string | null>(null);
  const isQueued = ref(false);
  const queueStatus = ref<QueueStatusInfo | null>(null);

  // ---- 消息队列 ----
  const messageQueue = ref<QueuedMessage[]>([]);
  let queueCounter = 0;

  // ---- 模式切换 ----
  // 保存最后一条用户消息，用于智能模式切换时重新发送
  const lastUserMessage = ref<{ text: string; files?: { path: string; name: string }[] } | null>(null);

  // ---- 对外 Actions ----

  async function sendMessage(
    text: string,
    files?: { path: string; name: string }[],
    options?: { skillRef?: string }
  ): Promise<void> {
    if (!text.trim()) return;

    // 如果正在处理，加入队列
    if (isStreaming.value) {
      messageQueue.value.push({
        id: `queue-${++queueCounter}`,
        text,
        files,
        timestamp: Date.now()
      });
      return;
    }

    // 否则直接发送
    await sendMessageInternal(text, files, options?.skillRef);
  }

  async function sendMessageInternal(
    text: string,
    files?: { path: string; name: string }[],
    skillRef?: string,
    forcedMode?: 'agent' | 'orchestrator' | 'swarm' | 'discussion' | 'quality-loop' | 'delegate'
  ): Promise<void> {
    // 保存最后一条用户消息（用于智能模式切换）
    lastUserMessage.value = { text, files };

    // 构建完整消息（包含文件路径）
    let finalMessage = text;
    if (files && files.length > 0) {
      const filePaths = files.map((f) => `@${f.path}`).join(' ');
      finalMessage = `${text} ${filePaths}`;
    }

    // 显示和发送的消息保持一致
    addUserMessage(finalMessage);

    try {
      let agentId: string | undefined;
      try {
        const { useAgentsStore } = await import('./agents');
        const agentsStore = useAgentsStore();
        agentId = agentsStore.selectedAgentId ?? undefined;
      } catch {
        // agents store 未初始化时忽略
      }

      // 从 Thread 获取 mode（agentMode/agentType），或使用强制指定的模式
      let mode: 'agent' | 'orchestrator' | 'swarm' | 'discussion' | 'quality-loop' | 'delegate' = forcedMode || 'agent';
      const oldSessionId = sessionId.value;

      if (!forcedMode && oldSessionId) {
        try {
          const { useThreadsStore } = await import('./threads');
          const threadsStore = useThreadsStore();
          const thread = threadsStore.threads.find((t) => t.id === oldSessionId);
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
        sessionId: oldSessionId,
        mode,
        ...(agentId ? { agentId } : {}),
        ...(skillRef ? { skillRef } : {})
      });

      if (result) {
        const { sessionId: sid, status, error } = result;

        if (status === 'error') {
          addErrorMessage(error || '启动 Agent 失败');
          return;
        }

        if (oldSessionId && oldSessionId !== sid) {
          streamUnsubscribe(oldSessionId);
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
      // 若 pendingApproval 标记了子 sessionId，则优先使用
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
    if (sessionId.value) {
      streamUnsubscribe(sessionId.value);
    }
    sessionId.value = null;
    isQueued.value = false;
    queueStatus.value = null;
    messageQueue.value = [];
  }

  function removeFromQueue(queueId: string): void {
    messageQueue.value = messageQueue.value.filter((q) => q.id !== queueId);
  }

  // ---- 自动处理队列 ----
  watch(isStreaming, async (streaming) => {
    if (!streaming && messageQueue.value.length > 0) {
      // 处理完成，自动发送队列中的下一条
      const next = messageQueue.value.shift();
      if (next) {
        await sendMessageInternal(next.text, next.files);
      }
    }
  });

  /**
   * 加载 Thread 的历史对话
   *
   * 从后端读取 events.jsonl + session 文件，直接构建 UI 消息列表。
   * 使用聚合事件（*:done）而非增量事件（*:delta）来重建完整的对话。
   */
  async function loadHistory(threadId: string): Promise<void> {
    const BASE = `${configManager.getBaseUrl()}/gateway/threads`;
    // 使用当前请求的 ID，如果 fetch 返回时 active threadId 已经变了，则丢弃结果
    const currentLoadThreadId = threadId;

    try {
      const res = await fetch(`${BASE}/${threadId}/history`);
      if (!res.ok) return;

      const data = (await res.json()) as {
        events: { ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }[];
        userMessages: { content: string; timestamp: number }[];
      };

      // 快速切换会话导致过期的请求返回了数据，直接丢弃
      if (sessionId.value !== currentLoadThreadId) {
        return;
      }

      resetAll();

      const { events, userMessages } = data;
      if (events.length === 0 && userMessages.length === 0) return;

      let currentMsg: StreamChatMessage | undefined;
      let userIdx = 0;
      let msgCounter = 0;

      for (const evt of events) {
        switch (evt.type) {
          case 'run:start':
            if (userIdx < userMessages.length) {
              addUserMessage(userMessages[userIdx].content);
              userIdx++;
            }
            currentMsg = {
              id: `hist-assistant-${++msgCounter}`,
              role: 'assistant',
              content: '',
              blocks: [],
              status: 'streaming',
              timestamp: new Date(evt.ts).getTime()
            };
            messages.value.push(currentMsg);
            break;

          case 'reasoning:done':
            if (currentMsg) {
              const text = (evt.data?.rawContent as string) || '';
              if (text) currentMsg.blocks.push({ type: 'thinking', text });
            }
            break;

          case 'text:done':
            if (currentMsg) {
              const text = (evt.data?.text as string) || evt.content || '';
              if (text) {
                currentMsg.blocks.push({ type: 'text', text });
                currentMsg.content = text;
              }
            }
            break;

          case 'tool:start':
            if (currentMsg) {
              currentMsg.blocks.push({
                type: 'tool',
                tool: {
                  name: (evt.data?.toolName as string) || evt.content,
                  arguments: (evt.data?.arguments as string) || '',
                  status: 'calling'
                }
              });
            }
            break;

          case 'tool:done':
            if (currentMsg) {
              for (let i = currentMsg.blocks.length - 1; i >= 0; i--) {
                const b = currentMsg.blocks[i];
                if (b.type === 'tool' && b.tool.status === 'calling') {
                  b.tool.result = evt.content || (evt.data?.output as string) || '';
                  b.tool.status = 'done';
                  break;
                }
              }
            }
            break;

          case 'hitl:required':
            if (currentMsg) {
              if (!currentMsg.pendingApprovals) currentMsg.pendingApprovals = [];
              currentMsg.pendingApprovals.push({
                index: (evt.data?.index as number) ?? currentMsg.pendingApprovals.length,
                toolName: (evt.data?.toolName as string) || 'unknown',
                arguments: evt.data?.arguments as string | undefined
              });
            }
            break;

          case 'hitl:approved':
          case 'hitl:rejected': {
            if (currentMsg?.pendingApprovals) {
              const targetIndex = evt.data?.index as number | undefined;
              if (targetIndex != null) {
                // 从 pendingApprovals 中移除已处理的审批
                // 避免在重新加载历史时显示已过期的审批弹窗
                currentMsg.pendingApprovals = currentMsg.pendingApprovals.filter((a) => a.index !== targetIndex);
              }
            }
            break;
          }

          case 'delegate:start':
            if (currentMsg) {
              currentMsg.blocks.push({
                type: 'delegate',
                delegate: {
                  agentId: (evt.data?.agentId as string) || 'unknown',
                  agentName: evt.data?.agentName as string | undefined,
                  task: evt.data?.task as string | undefined,
                  status: 'running'
                }
              });
            }
            break;

          case 'delegate:done':
            if (currentMsg) {
              for (let i = currentMsg.blocks.length - 1; i >= 0; i--) {
                const b = currentMsg.blocks[i];
                if (b.type === 'delegate' && b.delegate.status === 'running') {
                  b.delegate.status = 'done';
                  b.delegate.output = evt.content || undefined;
                  b.delegate.duration = evt.data?.duration as number | undefined;
                  break;
                }
              }
            }
            break;

          case 'run:done':
            if (currentMsg) {
              currentMsg.status = 'done';
              // 清理未处理的审批（异步模式下 agent run 可能在审批前就结束）
              // 避免显示已过期的审批弹窗
              if (currentMsg.pendingApprovals && currentMsg.pendingApprovals.length > 0) {
                currentMsg.pendingApprovals = [];
              }
              currentMsg = undefined;
            }
            break;

          case 'run:error':
            if (currentMsg) {
              currentMsg.status = 'error';
              currentMsg.error = evt.content;
              currentMsg = undefined;
            }
            break;

          default:
            break;
        }
      }

      // 确保最后一条 assistant 消息标记完成
      if (currentMsg && currentMsg.status === 'streaming') {
        currentMsg.status = 'done';
      }

      // 订阅该 session 的后续实时事件
      streamSubscribe(threadId, handleStreamMessage);
    } catch (err) {
      console.warn('[chatStore] loadHistory failed:', err);
    }
  }

  // ---- 智能模式切换监听器 ----
  // 当 Agent 检测到复杂任务时，自动切换到 orchestrator 模式
  gateway.on('mode.switch-requested', async (data: unknown) => {
    const payload = data as Record<string, unknown>;
    const { targetMode, reason } = payload;
    console.log(`[chatStore] Mode switch requested:`, { targetMode, reason });

    // 显示切换提示
    addUserMessage(
      `\n---\n\n🔄 **正在切换到${targetMode === 'orchestrator' ? '编排' : targetMode}模式**\n\n${reason || '检测到复杂任务'}\n\n---\n`
    );

    // 如果有保存的最后一条用户消息，重新发送
    if (lastUserMessage.value && targetMode === 'orchestrator') {
      // 等待当前 stream 完成
      if (isStreaming.value) {
        await new Promise<void>((resolve) => {
          const unwatch = watch(isStreaming, (streaming) => {
            if (!streaming) {
              unwatch();
              resolve();
            }
          });
        });
      }

      // 自动重新发送，使用 orchestrator 模式
      await sendMessageInternal(lastUserMessage.value.text, lastUserMessage.value.files, undefined, 'orchestrator');
    }
  });

  return {
    sessionId,
    messages,
    isStreaming,
    execOutputs,
    isQueued,
    queueStatus,
    messageQueue,
    sendMessage,
    abortSession,
    submitDecision,
    clearMessages,
    removeFromQueue,
    loadHistory
  };
});
