<script setup lang="ts">
/**
 * ChatPanel — 对话面板（轻量化重构版）
 *
 * Agent 的对话交互区域：消息流、工具调用、HITL 审批。
 * 重构：messages 由组件本地持有（useStreamHandler），unmounted 时自动释放。
 */

import { ref, inject, provide, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useStreamHandler } from '@/composables/useStreamHandler';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision, StreamMessage } from '@shared/stream-protocol';
import { gateway } from '@/plugins/gatewaySetup';
import configManager from '@/config';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import ChatInput from '@/components/chat/ChatInput.vue';
import MessageQueue from '@/components/chat/MessageQueue.vue';
import type { Ref } from 'vue';

// ==================== Props ====================
const props = defineProps<{
  threadId: string;
}>();

// ==================== Store & Composables ====================
const chatStore = useChatStore();
const streamState = chatStore.getState(props.threadId); // 仅队列状态

// 使用 useStreamHandler 管理本地消息（组件级状态）
const { messages, isStreaming, execOutputs, handleStreamMessage, addUserMessage, resetAll } = useStreamHandler({
  idPrefix: 'chat',
  maxMessages: 500
});

// ==================== Refs ====================
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const isCollapsed = defineModel<boolean>('collapsed', { default: false });
const pendingSkillRef = inject<Ref<string | null>>('pendingSkillRef', ref(null));

// 提供 execOutputs 给子组件（如 TerminalPanel）
provide('execOutputs', execOutputs);

// ==================== Methods ====================
function scrollToBottom(force = false): void {
  chatMessagesRef.value?.scrollToBottom(force);
}

function insertFileReference(file: { path: string; name: string }): void {
  chatInputRef.value?.insertFileReference(file);
}

function insertSkillPrompt(prompt: string): void {
  chatInputRef.value?.setInputText(prompt);
}

// 新消息到达 → 自动滚动
watch(
  () => messages.value.length,
  () => scrollToBottom()
);

// 流式内容增量更新 → 自动滚动
watch(
  () => {
    const msgs = messages.value;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

async function handleSend(data: { text: string; files: { path: string; name: string }[] }): Promise<void> {
  if (!data.text) return;

  scrollToBottom(true);

  const skillRef = pendingSkillRef.value ?? undefined;
  if (pendingSkillRef.value) {
    pendingSkillRef.value = null;
  }

  // 添加用户消息到本地
  addUserMessage(data.text);

  // 发送到后端（后端会推送流式事件）
  await chatStore.sendMessage(props.threadId, data.text, data.files, skillRef ? { skillRef } : undefined);
}

async function handleStop(): Promise<void> {
  await chatStore.abortSession(props.threadId);
}

function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (approval.decision) return;

  chatStore.submitDecision(props.threadId, approval.index, decision, approval.sessionId);

  const decisionText = decision === 'approve-once' ? '已允许' : decision === 'approve-always' ? '始终允许' : '已拒绝';

  messages.value.push({
    id: `user-decision-${Date.now()}`,
    role: 'user',
    content: `[${decisionText}执行 ${approval.toolName} 工具]`,
    blocks: [],
    status: 'done',
    timestamp: Date.now()
  });
}

// ==================== 运行状态验证 ====================
let statusCheckTimer: ReturnType<typeof setInterval> | null = null;
const STATUS_CHECK_INTERVAL = 15_000;

async function verifyRunStatus(): Promise<void> {
  if (!isStreaming.value) return;

  try {
    const baseUrl = configManager.getBaseUrl();
    const res = await fetch(`${baseUrl}/gateway/threads/${props.threadId}`);
    if (res.ok) {
      const data = (await res.json()) as { thread?: { runStatus?: string } };
      const backendStatus = data?.thread?.runStatus;
      if (backendStatus && !['running', 'tool-pending', 'approval-pending'].includes(backendStatus)) {
        console.warn(`[ChatPanel] Backend runStatus="${backendStatus}" but frontend is streaming. Force ending.`);
        isStreaming.value = false;
        chatStore.setStreaming(props.threadId, false);
      }
    }
  } catch {
    // Silent fail
  }
}

// ==================== 流式消息处理包装 ====================

/**
 * 处理流式消息并同步 Store 的 isStreaming 状态
 */
function handleStreamMessageWithSync(msg: StreamMessage): void {
  // 更新本地消息
  handleStreamMessage(msg);

  // 同步 Store 的 isStreaming 状态
  if (msg.type === 'run:start') {
    chatStore.setStreaming(props.threadId, true);
  } else if (msg.type === 'run:done' || msg.type === 'run:error') {
    chatStore.setStreaming(props.threadId, false);
  }
}

// ==================== 订阅管理 ====================

let subscribed = false;

function ensureSubscription(): void {
  if (!subscribed) {
    streamSubscribe(props.threadId, handleStreamMessageWithSync);
    subscribed = true;
  }
}

function unsubscribe(): void {
  if (subscribed) {
    streamUnsubscribe(props.threadId);
    subscribed = false;
  }
}

// Watch isStreaming: 管理状态检查定时器
watch(
  isStreaming,
  (streaming, wasStreaming) => {
    if (streaming) {
      if (!statusCheckTimer) {
        statusCheckTimer = setInterval(verifyRunStatus, STATUS_CHECK_INTERVAL);
      }
    } else {
      // 流式处理结束，取消订阅
      if (wasStreaming) {
        unsubscribe();
      }
      if (statusCheckTimer) {
        clearInterval(statusCheckTimer);
        statusCheckTimer = null;
      }
    }
  },
  { immediate: true }
);

// ==================== 历史加载 ====================

async function loadThreadHistory(): Promise<void> {
  try {
    const history = await chatStore.loadHistory(props.threadId);

    if (history.messages.length === 0 && history.userMessages.length === 0) {
      return;
    }

    resetAll(); // 清空旧消息

    let userIdx = 0;

    for (const evt of history.messages) {
      // 转换历史事件为 StreamMessage 格式
      const streamMsg: StreamMessage = {
        id: `hist-${evt.seq}`,
        sessionId: props.threadId,
        sequence: evt.seq,
        timestamp: new Date(evt.ts).getTime(),
        type: evt.type as StreamMessage['type'],
        content: evt.content,
        data: evt.data,
        source: { type: 'agent', id: props.threadId, name: '' }
      };

      switch (evt.type) {
        case 'run:start':
          if (userIdx < history.userMessages.length) {
            addUserMessage(history.userMessages[userIdx].content);
            userIdx++;
          }
          handleStreamMessage(streamMsg);
          break;

        default:
          // 其他历史事件通过 handleStreamMessage 处理
          handleStreamMessage(streamMsg);
          break;
      }
    }

    await nextTick();
    scrollToBottom(true);
  } catch (err: unknown) {
    console.error('[ChatPanel] loadThreadHistory error:', err);
  }
}

// ==================== 生命周期 ====================
onMounted(async () => {
  scrollToBottom();
  // 加载历史消息
  await loadThreadHistory();
  // 订阅流式更新
  if (!isStreaming.value) {
    ensureSubscription();
  }
});

onUnmounted(() => {
  unsubscribe();
  if (statusCheckTimer) {
    clearInterval(statusCheckTimer);
    statusCheckTimer = null;
  }
  // messages 由 Vue 自动释放，无需手动清理 ✅
});

defineExpose({
  insertFileReference,
  insertSkillPrompt
});
</script>

<template>
  <aside v-show="!isCollapsed" class="flex min-h-0 flex-1 flex-col border-l border-gray-200/80 bg-[#f7f7f8]">
    <!-- 消息区域 -->
    <ChatMessages ref="chatMessagesRef" :messages="messages" :is-streaming="isStreaming" @decide="handleApproval">
      <template #empty>
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <span class="i-carbon-chat-bot inline-block h-6 w-6 text-primary"></span>
        </div>
        <h2 class="mb-1 text-sm font-semibold text-gray-600">有什么可以帮您？</h2>
        <p class="text-center text-xs text-gray-400">输入消息开始对话</p>
      </template>
    </ChatMessages>

    <!-- 队列状态提示 -->
    <div
      v-if="streamState.isQueued && streamState.queueStatus"
      class="flex items-center gap-1.5 border-t border-amber-200/80 bg-amber-50/60 px-3 py-1.5">
      <span class="i-carbon-queue inline-block h-3 w-3 text-amber-500"></span>
      <span class="text-[10px] text-amber-600">
        消息已排队 (位置:
        {{ streamState.queueStatus.queueLength }})
      </span>
    </div>

    <!-- 待发送消息队列 -->
    <MessageQueue
      :queue="streamState.messageQueue"
      @remove="(queueId) => chatStore.removeFromQueue(threadId, queueId)" />

    <!-- 输入区域 -->
    <ChatInput
      ref="chatInputRef"
      :placeholder="isStreaming ? '可继续输入（消息将排队处理）' : '输入消息... (Enter 发送，Shift+Enter 换行)'"
      :disabled="false"
      :show-stop-button="isStreaming"
      @send="handleSend"
      @stop="handleStop" />

    <!-- 错误提示 -->
    <div v-if="gateway.lastError.value" class="error-banner">
      <span class="i-carbon-warning inline-block h-3 w-3"></span>
      <span>{{ gateway.lastError.value }}</span>
    </div>
  </aside>
</template>

<style scoped>
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
  font-size: 11px;
  border-top: 1px solid hsl(var(--error) / 0.2);
}
</style>
