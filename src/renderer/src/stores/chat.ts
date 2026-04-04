/**
 * Chat Store (重构版)
 *
 * 职责：按 threadId 隔离管理多个 Thread 的对话状态。
 * 每个 Thread 有独立的消息列表、流式状态、消息队列。
 * 组件通过 getState(threadId) 获取对应的状态（reactive）。
 */

import { defineStore } from 'pinia';
import { ref, computed, type ComputedRef } from 'vue';
import configManager from '@/config';
import { gateway } from '@/plugins/gatewaySetup';
import type { StreamMessage, HitlApprovalDecision } from '@shared/stream-protocol';

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

import type { StreamChatMessage, ExecOutputEntry, ToolCallInfo } from '@/composables/useStreamHandler';

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

/** 单个 Thread 的对话状态 */
export interface ThreadChatState {
  messages: StreamChatMessage[];
  isStreaming: boolean;
  execOutputs: ExecOutputEntry[];
  isQueued: boolean;
  queueStatus: QueueStatusInfo | null;
  messageQueue: QueuedMessage[];
  queueCounter: number;
  messageCounter: number;
  lastUserMessage: { text: string; files?: { path: string; name: string }[] } | null;
}

// ==================== Store ====================

export const useChatStore = defineStore('chat', () => {
  // ---- 按 threadId 隔离的状态 ----
  const threadStates = ref(new Map<string, ThreadChatState>());

  /** 创建默认的 Thread 状态 */
  function createDefaultState(): ThreadChatState {
    return {
      messages: [],
      isStreaming: false,
      execOutputs: [],
      isQueued: false,
      queueStatus: null,
      messageQueue: [],
      queueCounter: 0,
      messageCounter: 0,
      lastUserMessage: null
    };
  }

  /** 获取或创建 Thread 状态 */
  function getThreadState(threadId: string): ThreadChatState {
    if (!threadStates.value.has(threadId)) {
      threadStates.value.set(threadId, createDefaultState());
    }
    return threadStates.value.get(threadId)!;
  }

  /** 获取 Thread 状态（响应式计算属性版本，供组件使用） */
  function getState(threadId: string): ComputedRef<ThreadChatState> {
    return computed(() => getThreadState(threadId));
  }

  /** 清理 Thread 状态 */
  function clearThreadState(threadId: string): void {
    threadStates.value.delete(threadId);
  }

  // ==================== 消息处理辅助函数 ====================

  function trimMessages(state: ThreadChatState, maxMessages = 500): void {
    if (state.messages.length > maxMessages) {
      state.messages = state.messages.slice(-maxMessages);
    }
  }

  function getCurrentAssistantMessage(state: ThreadChatState): StreamChatMessage | undefined {
    const last = state.messages[state.messages.length - 1];
    return last?.role === 'assistant' && last.status === 'streaming' ? last : undefined;
  }

  function createAssistantMessage(state: ThreadChatState): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `chat-assistant-${++state.messageCounter}`,
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'streaming',
      timestamp: Date.now()
    };
    state.messages.push(msg);
    trimMessages(state);
    return msg;
  }

  function addUserMessage(state: ThreadChatState, text: string): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `chat-user-${++state.messageCounter}`,
      role: 'user',
      content: text,
      blocks: [],
      status: 'done',
      timestamp: Date.now()
    };
    state.messages.push(msg);
    trimMessages(state);
    return msg;
  }

  function addErrorMessage(state: ThreadChatState, error: string): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `chat-error-${++state.messageCounter}`,
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'error',
      error,
      timestamp: Date.now()
    };
    state.messages.push(msg);
    return msg;
  }

  const EXEC_TOOL_NAMES = new Set(['exec_command', 'exec']);

  function isExecTool(name: string): boolean {
    return EXEC_TOOL_NAMES.has(name);
  }

  function findLastCallingTool(assistantMsg: StreamChatMessage): ToolCallInfo | undefined {
    for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
      const block = assistantMsg.blocks[i];
      if (block.type === 'tool' && block.tool.status === 'calling') {
        return block.tool;
      }
    }
    return undefined;
  }

  // ==================== 流式消息处理 ====================

  /**
   * 处理流式消息（根据 sessionId 找到对应的 threadId）
   */
  function handleStreamMessage(msg: StreamMessage): void {
    const threadId = msg.sessionId; // sessionId === threadId
    if (!threadId) return;

    const state = getThreadState(threadId);
    let assistantMsg = getCurrentAssistantMessage(state);

    switch (msg.type) {
      case 'run:start':
        state.isStreaming = true;
        if (!assistantMsg) createAssistantMessage(state);
        break;

      case 'text:delta': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);
        assistantMsg.content += msg.content;
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += msg.content;
        } else {
          assistantMsg.blocks.push({ type: 'text', text: msg.content });
        }
        break;
      }

      case 'reasoning:delta': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += msg.content;
        } else {
          assistantMsg.blocks.push({ type: 'thinking', text: msg.content });
        }
        break;
      }

      case 'tool:start': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);
        assistantMsg.blocks.push({
          type: 'tool',
          tool: {
            name: (msg.data?.toolName as string) || msg.content,
            arguments: (msg.data?.arguments as string) || '',
            status: 'calling'
          }
        });
        break;
      }

      case 'tool:delta': {
        if (assistantMsg) {
          const currentTool = findLastCallingTool(assistantMsg);
          if (currentTool && isExecTool(currentTool.name)) {
            state.execOutputs.push({
              timestamp: Date.now(),
              type: 'progress',
              toolName: currentTool.name,
              content: msg.content
            });
          }
        }
        break;
      }

      case 'tool:done': {
        if (assistantMsg) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const suspended = (msg.data as any)?.suspended === true;

          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i];
            if (block.type === 'tool' && block.tool.status === 'calling') {
              if (isExecTool(block.tool.name)) {
                state.execOutputs.push({
                  timestamp: Date.now(),
                  type: 'result',
                  toolName: block.tool.name,
                  content: msg.content
                });
              }
              block.tool.result = msg.content;

              if (suspended) {
                block.tool.status = 'approval-pending';
              } else {
                block.tool.status = 'done';
              }

              // 检测 write 工具写入的音频文件
              if (block.tool.name === 'write') {
                const audioMatch = msg.content.match(/["']?([^"'\s]+\.(mp3|wav|m4a|aac|flac|webm))["']?/i);
                if (audioMatch) {
                  const absPath = audioMatch[1];
                  const baseUrl = configManager.getBaseUrl();
                  const audioUrl = `${baseUrl}/gateway/files/serve?path=${encodeURIComponent(absPath)}`;
                  const fileName =
                    absPath
                      .split('/')
                      .pop()
                      ?.replace(/\.(mp3|wav|m4a|aac|flac|webm)$/i, '') || '语音';
                  assistantMsg!.blocks.push({
                    type: 'audio',
                    src: audioUrl,
                    title: fileName
                  });
                }
              }

              break;
            }
          }
        }
        break;
      }

      case 'run:done':
        if (assistantMsg) {
          assistantMsg.status = 'done';
          if (assistantMsg.pendingApprovals) {
            for (const approval of assistantMsg.pendingApprovals) {
              if (!approval.decision) {
                approval.canShow = true;
              }
            }
          }
        }
        state.isStreaming = false;
        state.isQueued = false;
        state.queueStatus = null;
        break;

      case 'run:error':
        if (assistantMsg) {
          assistantMsg.status = 'error';
          assistantMsg.error = msg.content;
        } else {
          addErrorMessage(state, msg.content);
        }
        state.isStreaming = false;
        state.isQueued = false;
        state.queueStatus = null;
        break;

      case 'hitl:required': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);

        const toolName = (msg.data?.toolName as string) || 'unknown';
        const approvalIndex = (msg.data?.index as number) ?? 0;
        const approvalSessionId = (msg.data?.subSessionId as string) || msg.sessionId;

        if (!assistantMsg.pendingApprovals) {
          assistantMsg.pendingApprovals = [];
        }
        assistantMsg.pendingApprovals.push({
          index: approvalIndex,
          toolName,
          arguments: msg.data?.arguments as string | undefined,
          sessionId: approvalSessionId,
          canShow: false
        });
        break;
      }

      case 'hitl:approved':
      case 'hitl:rejected': {
        if (assistantMsg && assistantMsg.pendingApprovals) {
          const targetIndex = msg.data?.index as number | undefined;
          const decision: HitlApprovalDecision = msg.type === 'hitl:approved' ? 'approve-once' : 'reject';

          if (targetIndex != null) {
            const approval = assistantMsg.pendingApprovals.find((a) => a.index === targetIndex);
            if (approval) {
              approval.decision = decision;
            }
          }
        }
        break;
      }

      case 'run:interrupted':
        if (assistantMsg) assistantMsg.status = 'interrupted';
        state.isStreaming = false;
        break;

      case 'run:resumed':
        if (assistantMsg) assistantMsg.status = 'streaming';
        state.isStreaming = true;
        break;

      case 'delegate:start': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);
        assistantMsg.blocks.push({
          type: 'delegate',
          delegate: {
            agentId: (msg.data?.agentId as string) || 'unknown',
            agentName: msg.data?.agentName as string | undefined,
            task: msg.data?.task as string | undefined,
            status: 'running'
          }
        });
        break;
      }

      case 'delegate:done': {
        if (assistantMsg) {
          const agentId = msg.data?.agentId as string | undefined;
          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i];
            if (
              block.type === 'delegate' &&
              block.delegate.status === 'running' &&
              (!agentId || block.delegate.agentId === agentId)
            ) {
              block.delegate.status = 'done';
              block.delegate.output = msg.content || undefined;
              block.delegate.duration = msg.data?.duration as number | undefined;
              break;
            }
          }
        }
        break;
      }

      case 'quality:round_start':
      case 'quality:validating':
      case 'quality:score':
      case 'quality:repairing':
      case 'quality:done': {
        if (!assistantMsg) assistantMsg = createAssistantMessage(state);
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'quality') {
          lastBlock.status = msg.content;
          lastBlock.detail = msg.data ? JSON.stringify(msg.data) : undefined;
        } else {
          assistantMsg.blocks.push({
            type: 'quality',
            status: msg.content,
            detail: msg.data ? JSON.stringify(msg.data) : undefined
          });
        }
        break;
      }

      default:
        break;
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

    addUserMessage(state, finalMessage);

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
        const { status, error } = result;

        if (status === 'error') {
          addErrorMessage(state, error || '启动 Agent 失败');
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
      const errMsg = err instanceof Error ? err.message : String(err);
      addErrorMessage(state, errMsg);
    }
  }

  /**
   * 提交 HITL 审批决策
   */
  async function submitDecision(threadId: string, index: number, decision: HitlApprovalDecision): Promise<void> {
    try {
      const state = getThreadState(threadId);
      let targetSessionId = threadId;
      const lastMsg = state.messages[state.messages.length - 1];
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

  /**
   * 中止会话
   */
  async function abortSession(threadId: string): Promise<void> {
    try {
      await gateway.request<{ sessionId: string; aborted: boolean }>('chat.abort', {
        sessionId: threadId
      });
      const state = getThreadState(threadId);
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.status === 'streaming') {
        lastMsg.status = 'interrupted';
      }
      state.isStreaming = false;
      state.isQueued = false;
      state.queueStatus = null;
    } catch (err: unknown) {
      console.error('[chatStore] abortSession error:', err);
    }
  }

  /**
   * 清空某个 Thread 的消息
   */
  function clearMessages(threadId: string): void {
    const state = getThreadState(threadId);
    state.messages = [];
    state.execOutputs = [];
    state.isStreaming = false;
    state.isQueued = false;
    state.queueStatus = null;
    state.messageQueue = [];
    state.messageCounter = 0;
  }

  /**
   * 从队列中移除消息
   */
  function removeFromQueue(threadId: string, queueId: string): void {
    const state = getThreadState(threadId);
    state.messageQueue = state.messageQueue.filter((q) => q.id !== queueId);
  }

  /**
   * 加载 Thread 的历史对话
   */
  async function loadHistory(threadId: string): Promise<void> {
    const BASE = `${configManager.getBaseUrl()}/gateway/threads`;

    try {
      const res = await fetch(`${BASE}/${threadId}/history`);
      if (!res.ok) return;

      const data = (await res.json()) as {
        events: { ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }[];
        userMessages: { content: string; timestamp: number }[];
      };

      const state = getThreadState(threadId);
      state.messages = [];
      state.execOutputs = [];
      state.isStreaming = false;
      state.messageCounter = 0;

      const { events, userMessages } = data;
      if (events.length === 0 && userMessages.length === 0) return;

      let currentMsg: StreamChatMessage | undefined;
      let userIdx = 0;

      for (const evt of events) {
        switch (evt.type) {
          case 'run:start':
            if (userIdx < userMessages.length) {
              addUserMessage(state, userMessages[userIdx].content);
              userIdx++;
            }
            currentMsg = {
              id: `hist-assistant-${++state.messageCounter}`,
              role: 'assistant',
              content: '',
              blocks: [],
              status: 'streaming',
              timestamp: new Date(evt.ts).getTime()
            };
            state.messages.push(currentMsg);
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
            if (currentMsg && currentMsg.pendingApprovals) {
              const targetIndex = evt.data?.index as number | undefined;
              const decision: HitlApprovalDecision = evt.type === 'hitl:approved' ? 'approve-once' : 'reject';
              if (targetIndex != null) {
                const approval = currentMsg.pendingApprovals.find((a) => a.index === targetIndex);
                if (approval) {
                  approval.decision = decision;
                }
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
              const agentId = evt.data?.agentId as string | undefined;
              for (let i = currentMsg.blocks.length - 1; i >= 0; i--) {
                const b = currentMsg.blocks[i];
                if (
                  b.type === 'delegate' &&
                  b.delegate.status === 'running' &&
                  (!agentId || b.delegate.agentId === agentId)
                ) {
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
              if (currentMsg.pendingApprovals) {
                for (const approval of currentMsg.pendingApprovals) {
                  if (!approval.decision) {
                    approval.canShow = true;
                  }
                }
              }
            }
            break;

          case 'run:error':
            if (currentMsg) {
              currentMsg.status = 'error';
              currentMsg.error = evt.content;
            }
            break;

          default:
            break;
        }
      }
    } catch (err: unknown) {
      console.error('[chatStore] loadHistory error:', err);
    }
  }

  return {
    threadStates,
    getState,
    getThreadState,
    clearThreadState,
    handleStreamMessage,
    sendMessage,
    abortSession,
    submitDecision,
    clearMessages,
    removeFromQueue,
    loadHistory
  };
});
