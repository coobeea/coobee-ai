/**
 * Copilot Store — 应用管家悬浮对话状态
 *
 * 独立于主 ChatStore，拥有自己的消息列表、会话 ID 和流式订阅。
 * 始终使用 app-copilot Agent，通过 Gateway RPC chat.send 通信。
 *
 * 流式事件通过独立的 gateway.on('stream.message') 监听，
 * 按 sessionId 过滤，不与主聊天的 useStreamWs 冲突。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import type { StreamMessage } from '@shared/stream-protocol';

// ==================== 类型 ====================

/** 工具调用信息（简化版，copilot 场景只需基础展示） */
export interface CopilotToolCall {
  name: string;
  arguments: string;
  result?: string;
  status: 'calling' | 'done' | 'error';
}

/** 内容块 */
export type CopilotBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: CopilotToolCall };

/** 对话消息 */
export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: CopilotBlock[];
  status: 'sending' | 'streaming' | 'done' | 'error';
  error?: string;
  timestamp: number;
}

// ==================== 常量 ====================

const COPILOT_AGENT_ID = 'app-copilot';
const MAX_MESSAGES = 100;

// ==================== Store ====================

export const useCopilotStore = defineStore('copilot', () => {
  // ---- State ----
  const visible = ref(false);
  const sessionId = ref<string | null>(null);
  const messages = ref<CopilotMessage[]>([]);
  const isStreaming = ref(false);

  // ---- Stream 订阅 ----
  let unregisterStream: (() => void) | null = null;

  // ---- Getters ----
  const hasMessages = computed(() => messages.value.length > 0);

  // ---- 内部辅助 ----

  function getCurrentAssistantMessage(): CopilotMessage | undefined {
    const last = messages.value[messages.value.length - 1];
    return last?.role === 'assistant' && last.status === 'streaming' ? last : undefined;
  }

  function createAssistantMessage(): CopilotMessage {
    const msg: CopilotMessage = {
      id: `copilot-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'streaming',
      timestamp: Date.now()
    };
    messages.value.push(msg);
    if (messages.value.length > MAX_MESSAGES) {
      messages.value = messages.value.slice(-MAX_MESSAGES);
    }
    return msg;
  }

  /** 处理流式消息 */
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
          messages.value.push({
            id: `copilot-error-${Date.now()}`,
            role: 'assistant',
            content: '',
            blocks: [],
            status: 'error',
            error: msg.content,
            timestamp: Date.now()
          });
        }
        isStreaming.value = false;
        break;

      case 'interrupted':
        if (assistantMsg) assistantMsg.status = 'done';
        isStreaming.value = false;
        break;

      default:
        break;
    }
  }

  /** 初始化独立的流式事件监听 */
  function initStreamListener(): void {
    if (unregisterStream) return;

    unregisterStream = gateway.on('stream.message', (payload) => {
      const data = payload as { sessionId?: string; message?: StreamMessage } | undefined;
      if (!data?.message || !data.sessionId) return;
      // 只处理 copilot 会话的消息
      if (data.sessionId !== sessionId.value) return;
      handleStreamMessage(data.message);
    });

    // 重连后恢复订阅（全局生命周期，无需存储 unregister）
    gateway.onConnect(() => {
      if (sessionId.value) {
        gateway
          .request('stream.subscribe', { sessionId: sessionId.value })
          .catch((err) => console.error('[copilot] 重连后恢复订阅失败:', err));
      }
    });
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

  /** 发送消息给应用管家 */
  async function sendMessage(text: string): Promise<void> {
    if (!text.trim() || isStreaming.value) return;

    // 确保流式监听已初始化
    initStreamListener();

    // 添加用户消息
    messages.value.push({
      id: `copilot-user-${Date.now()}`,
      role: 'user',
      content: text,
      blocks: [],
      status: 'done',
      timestamp: Date.now()
    });

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
          messages.value.push({
            id: `copilot-error-${Date.now()}`,
            role: 'assistant',
            content: '',
            blocks: [],
            status: 'error',
            error: result.error || '启动管家失败',
            timestamp: Date.now()
          });
          return;
        }

        sessionId.value = result.sessionId;

        // 订阅流式事件
        gateway
          .request('stream.subscribe', { sessionId: result.sessionId })
          .catch((err) => console.error('[copilot] 流式订阅失败:', err));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messages.value.push({
        id: `copilot-error-${Date.now()}`,
        role: 'assistant',
        content: '',
        blocks: [],
        status: 'error',
        error: errMsg,
        timestamp: Date.now()
      });
    }
  }

  /** 中断当前会话 */
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

  /** 清空对话历史 */
  function clearMessages(): void {
    messages.value = [];
    sessionId.value = null;
    isStreaming.value = false;
  }

  return {
    // State
    visible,
    sessionId,
    messages,
    isStreaming,
    // Getters
    hasMessages,
    // Actions
    toggle,
    open,
    close,
    sendMessage,
    abort,
    clearMessages
  };
});
