/**
 * useStreamHandler — 通用流式消息处理 composable
 *
 * 统一 ChatStore 和 CopilotStore 的消息类型定义与 StreamMessage → UI Message 的映射逻辑。
 * StreamMessage.type 直接使用后端 StreamChunkType（如 text:delta, tool:start 等），不做映射。
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
  status: 'calling' | 'done' | 'error' | 'approval-pending';
  /** 审批信息（如果工具需要审批） */
  approval?: {
    index: number;
    approvalId?: string;
    decision?: HitlApprovalDecision;
  };
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
      case 'run:start':
        isStreaming.value = true;
        if (!assistantMsg) createAssistantMessage();
        break;

      case 'text:delta': {
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

      case 'reasoning:delta': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
        const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += msg.content;
        } else {
          assistantMsg.blocks.push({ type: 'thinking', text: msg.content });
        }
        break;
      }

      case 'tool:start': {
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

      case 'tool:done': {
        if (assistantMsg) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const suspended = (msg.data as any)?.suspended === true;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const suspendReason = (msg.data as any)?.suspendReason;

          for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = assistantMsg.blocks[i];
            if (block.type === 'tool' && block.tool.status === 'calling') {
              block.tool.result = msg.content;

              // 如果工具需要审批，状态设置为 approval-pending，而不是 done
              if (suspended) {
                block.tool.status = 'approval-pending';
                // 从 suspendReason 解析 approvalId
                // 格式: "approval-pending:sessionId:index:toolName"
                const match = suspendReason?.match(/approval-pending:([^:]+:[^:]+):/);
                block.tool.approval = {
                  index: -1, // 会在 hitl:required 事件中更新
                  approvalId: match ? match[1] : undefined
                };
              } else {
                block.tool.status = 'done';
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
          // 不清除 pendingApprovals！
          // 在异步审批模式下，Agent run 正常结束，但审批可能还在等待中
          // 只有当收到 hitl:approved 或 hitl:rejected 事件时才清除对应的审批项
        }
        isStreaming.value = false;
        break;

      case 'run:error':
        if (assistantMsg) {
          assistantMsg.status = 'error';
          assistantMsg.error = msg.content;
        } else {
          addErrorMessage(msg.content);
        }
        isStreaming.value = false;
        break;

      case 'hitl:required': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();

        const toolName = (msg.data?.toolName as string) || 'unknown';
        const approvalIndex = (msg.data?.index as number) ?? 0;

        // 找到对应的工具块，更新审批信息
        for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
          const block = assistantMsg.blocks[i];
          if (block.type === 'tool' && block.tool.name === toolName && block.tool.status === 'approval-pending') {
            // 更新审批 index
            if (block.tool.approval) {
              block.tool.approval.index = approvalIndex;
            }
            break;
          }
        }

        // 为了兼容性，仍然维护 pendingApprovals 数组（用于底部备用显示）
        if (!assistantMsg.pendingApprovals) {
          assistantMsg.pendingApprovals = [];
        }
        assistantMsg.pendingApprovals.push({
          index: approvalIndex,
          toolName,
          arguments: msg.data?.arguments as string | undefined
        });
        break;
      }

      case 'hitl:approved':
      case 'hitl:rejected': {
        if (assistantMsg) {
          const targetIndex = msg.data?.index as number | undefined;
          const decision: HitlApprovalDecision = msg.type === 'hitl:approved' ? 'approve-once' : 'reject';

          if (targetIndex != null) {
            // 更新对应工具块的审批决策
            for (const block of assistantMsg.blocks) {
              if (block.type === 'tool' && block.tool.approval && block.tool.approval.index === targetIndex) {
                block.tool.approval.decision = decision;

                // 更新工具状态
                if (decision !== 'reject') {
                  block.tool.status = 'calling'; // 审批通过后，工具开始执行
                } else {
                  block.tool.status = 'error'; // 拒绝后显示为失败
                }
                break;
              }
            }

            // 从 pendingApprovals 中移除已处理的审批（兼容底部显示）
            if (assistantMsg.pendingApprovals) {
              assistantMsg.pendingApprovals = assistantMsg.pendingApprovals.filter((a) => a.index !== targetIndex);
            }
          }
        }
        break;
      }

      case 'run:interrupted':
        if (assistantMsg) assistantMsg.status = 'interrupted';
        isStreaming.value = false;
        break;

      case 'run:resumed':
        if (assistantMsg) assistantMsg.status = 'streaming';
        isStreaming.value = true;
        break;

      case 'delegate:start': {
        if (!assistantMsg) assistantMsg = createAssistantMessage();
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
