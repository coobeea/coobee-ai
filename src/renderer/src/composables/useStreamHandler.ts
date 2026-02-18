/**
 * useStreamHandler — 通用流式消息处理 composable
 *
 * 统一 ChatStore 和 CopilotStore 的消息类型定义与 StreamMessage → UI Message 的映射逻辑。
 * 支持所有消息类型：text, thinking, tool_call, tool_result, hitl, delegate, interrupted, resumed。
 *
 * Usage:
 *   const { messages, isStreaming, handleStreamMessage, ... } = useStreamHandler({ idPrefix: 'chat' })
 */

import { ref, type Ref } from 'vue';
import type { StreamMessage, HitlApprovalDecision } from '@shared/stream-protocol';

// ==================== 共享类型 ====================

export interface ToolCallInfo {
  name: string;
  arguments: string;
  result?: string;
  status: 'calling' | 'done' | 'error';
}

export interface DelegateInfo {
  agentId: string;
  agentName?: string;
  task?: string;
  status: 'running' | 'done';
  output?: string;
  duration?: number;
}

export interface PendingApproval {
  index: number;
  toolName: string;
  arguments?: string;
  decision?: HitlApprovalDecision;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: ToolCallInfo }
  | { type: 'delegate'; delegate: DelegateInfo };

export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'interrupted';

export interface StreamChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: ContentBlock[];
  pendingApprovals?: PendingApproval[];
  status: MessageStatus;
  error?: string;
  timestamp: number;
}

// ==================== Composable ====================

interface StreamHandlerOptions {
  /** 消息 ID 前缀，用于区分来源 */
  idPrefix?: string;
  /** 最大保留消息数量 */
  maxMessages?: number;
}

export interface StreamHandlerReturn {
  messages: Ref<StreamChatMessage[]>;
  isStreaming: Ref<boolean>;
  getCurrentAssistantMessage: () => StreamChatMessage | undefined;
  createAssistantMessage: () => StreamChatMessage;
  addUserMessage: (text: string) => StreamChatMessage;
  addErrorMessage: (error: string) => StreamChatMessage;
  handleStreamMessage: (msg: StreamMessage) => void;
  resetAll: () => void;
}

export function useStreamHandler(options: StreamHandlerOptions = {}): StreamHandlerReturn {
  const { idPrefix = 'msg', maxMessages = 500 } = options;

  const messages = ref<StreamChatMessage[]>([]);
  const isStreaming = ref(false);

  function trimMessages(): void {
    if (messages.value.length > maxMessages) {
      messages.value = messages.value.slice(-maxMessages);
    }
  }

  function getCurrentAssistantMessage(): StreamChatMessage | undefined {
    const last = messages.value[messages.value.length - 1];
    return last?.role === 'assistant' && last.status === 'streaming' ? last : undefined;
  }

  function createAssistantMessage(): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `${idPrefix}-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'streaming',
      timestamp: Date.now()
    };
    messages.value.push(msg);
    trimMessages();
    return msg;
  }

  function addUserMessage(text: string): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `${idPrefix}-user-${Date.now()}`,
      role: 'user',
      content: text,
      blocks: [],
      status: 'done',
      timestamp: Date.now()
    };
    messages.value.push(msg);
    trimMessages();
    return msg;
  }

  function addErrorMessage(error: string): StreamChatMessage {
    const msg: StreamChatMessage = {
      id: `${idPrefix}-error-${Date.now()}`,
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'error',
      error,
      timestamp: Date.now()
    };
    messages.value.push(msg);
    return msg;
  }

  /**
   * StreamMessage → StreamChatMessage 的核心映射
   *
   * 按 blocks 数组维护时序：事件按到达顺序 push，模板按数组顺序渲染。
   */
  function handleStreamMessage(msg: StreamMessage): void {
    let assistantMsg = getCurrentAssistantMessage();

    switch (msg.type) {
      case 'start':
        isStreaming.value = true;
        if (!assistantMsg) createAssistantMessage();
        break;

      case 'text': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
        assistantMsg.content += msg.content;
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += msg.content;
        } else {
          assistantMsg.blocks.push({ type: 'text', text: msg.content });
        }
        break;
      }

      case 'thinking': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += msg.content;
        } else {
          assistantMsg.blocks.push({ type: 'thinking', text: msg.content });
        }
        break;
      }

      case 'tool_call': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
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

      case 'tool_result': {
        if (assistantMsg) {
          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i];
            if (block.type === 'tool' && block.tool.status === 'calling') {
              block.tool.result = msg.content;
              block.tool.status = 'done';
              break;
            }
          }
        }
        break;
      }

      case 'done':
        if (assistantMsg) assistantMsg.status = 'done';
        isStreaming.value = false;
        break;

      case 'error':
        if (assistantMsg) {
          assistantMsg.status = 'error';
          assistantMsg.error = msg.content;
        } else {
          addErrorMessage(msg.content);
        }
        isStreaming.value = false;
        break;

      case 'hitl':
        if (!assistantMsg) assistantMsg = createAssistantMessage();
        if (msg.data?.action === 'required') {
          if (!assistantMsg.pendingApprovals) {
            assistantMsg.pendingApprovals = [];
          }
          assistantMsg.pendingApprovals.push({
            index: (msg.data.index as number) ?? assistantMsg.pendingApprovals.length,
            toolName: (msg.data.toolName as string) || 'unknown',
            arguments: msg.data.arguments as string | undefined
          });
        } else if (msg.data?.action === 'approved' || msg.data?.action === 'rejected') {
          const targetIndex = msg.data.index as number | undefined;
          if (assistantMsg.pendingApprovals && targetIndex != null) {
            const approval = assistantMsg.pendingApprovals.find((a) => a.index === targetIndex);
            if (approval && !approval.decision) {
              approval.decision = msg.data.action === 'approved' ? 'approve-once' : 'reject';
            }
          }
        }
        break;

      case 'interrupted':
        if (assistantMsg) assistantMsg.status = 'interrupted';
        isStreaming.value = false;
        break;

      case 'resumed':
        if (assistantMsg) assistantMsg.status = 'streaming';
        isStreaming.value = true;
        break;

      case 'delegate': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
        const action = msg.data?.action as string | undefined;
        if (action === 'start') {
          assistantMsg.blocks.push({
            type: 'delegate',
            delegate: {
              agentId: (msg.data?.agentId as string) || 'unknown',
              agentName: msg.data?.agentName as string | undefined,
              task: msg.data?.task as string | undefined,
              status: 'running'
            }
          });
        } else if (action === 'done') {
          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i];
            if (block.type === 'delegate' && block.delegate.status === 'running') {
              block.delegate.status = 'done';
              block.delegate.output = msg.content || undefined;
              block.delegate.duration = msg.data?.duration as number | undefined;
              break;
            }
          }
        }
        break;
      }

      default:
        console.log(`[streamHandler:${idPrefix}] Unhandled message type: ${msg.type}`, msg);
        break;
    }
  }

  function resetAll(): void {
    messages.value = [];
    isStreaming.value = false;
  }

  return {
    messages,
    isStreaming,
    getCurrentAssistantMessage,
    createAssistantMessage,
    addUserMessage,
    addErrorMessage,
    handleStreamMessage,
    resetAll
  };
}
