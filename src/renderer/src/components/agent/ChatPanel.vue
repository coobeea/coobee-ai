<script setup lang="ts">
/**
 * ChatPanel — 对话面板（右栏）（重构版）
 *
 * Agent 的对话交互区域：消息流、工具调用、HITL 审批。
 * 重构：组件接收 threadId props，状态按 threadId 隔离，组件内管理订阅生命周期。
 */

import { ref, inject, watch, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
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

// ==================== Store & Refs ====================
const chatStore = useChatStore();
const state = chatStore.getState(props.threadId);
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

const pendingSkillRef = inject<Ref<string | null>>('pendingSkillRef', ref(null));

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
  () => state.value.messages.length,
  () => scrollToBottom()
);

// 流式内容增量更新 → 自动滚动
watch(
  () => {
    const msgs = state.value.messages;
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

  await chatStore.sendMessage(props.threadId, data.text, data.files, skillRef ? { skillRef } : undefined);
}

async function handleStop(): Promise<void> {
  await chatStore.abortSession(props.threadId);
}

function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (approval.decision) return;

  chatStore.submitDecision(props.threadId, approval.index, decision);

  const decisionText = decision === 'approve-once' ? '已允许' : decision === 'approve-always' ? '始终允许' : '已拒绝';

  state.value.messages.push({
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
  if (!state.value.isStreaming) return;

  try {
    const baseUrl = configManager.getBaseUrl();
    const res = await fetch(`${baseUrl}/gateway/threads/${props.threadId}`);
    if (res.ok) {
      const data = (await res.json()) as { thread?: { runStatus?: string } };
      const backendStatus = data?.thread?.runStatus;
      if (backendStatus && !['running', 'tool-pending', 'approval-pending'].includes(backendStatus)) {
        console.warn(`[ChatPanel] Backend runStatus="${backendStatus}" but frontend is streaming. Force ending.`);
        state.value.isStreaming = false;
      }
    }
  } catch {
    // Silent fail
  }
}

// ==================== 订阅管理 ====================
/**
 * 订阅生命周期优化：
 * - 在组件挂载时订阅
 * - 当流式处理开始时，确保订阅
 * - 当流式处理结束时（run:done/run:error），自动取消订阅
 * - 在组件卸载时，确保取消订阅
 */
let subscribed = false;

function ensureSubscription(): void {
  if (!subscribed) {
    streamSubscribe(props.threadId, chatStore.handleStreamMessage);
    subscribed = true;
  }
}

function unsubscribe(): void {
  if (subscribed) {
    streamUnsubscribe(props.threadId);
    subscribed = false;
  }
}

// Watch isStreaming: 开始时订阅，结束时取消订阅
watch(
  () => state.value.isStreaming,
  (streaming, wasStreaming) => {
    if (streaming) {
      ensureSubscription();
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

// ==================== 生命周期 ====================
onMounted(() => {
  scrollToBottom();
  // 初始订阅（如果当前正在 streaming，会被 watch 处理）
  if (!state.value.isStreaming) {
    ensureSubscription();
  }
});

onUnmounted(() => {
  unsubscribe();
  if (statusCheckTimer) {
    clearInterval(statusCheckTimer);
    statusCheckTimer = null;
  }
});

defineExpose({
  insertFileReference,
  insertSkillPrompt
});
</script>

<template>
  <aside v-show="!isCollapsed" class="flex min-h-0 flex-1 flex-col border-l border-gray-200/80 bg-[#f7f7f8]">
    <!-- 消息区域 -->
    <ChatMessages
      ref="chatMessagesRef"
      :messages="state.messages"
      :is-streaming="state.isStreaming"
      @decide="handleApproval">
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
      v-if="state.isQueued && state.queueStatus"
      class="flex items-center gap-1.5 border-t border-amber-200/80 bg-amber-50/60 px-3 py-1.5">
      <span class="i-carbon-queue inline-block h-3 w-3 text-amber-500"></span>
      <span class="text-[10px] text-amber-600">
        消息已排队 (位置:
        {{ state.queueStatus.queueLength }})
      </span>
    </div>

    <!-- 待发送消息队列 -->
    <MessageQueue :queue="state.messageQueue" @remove="(queueId) => chatStore.removeFromQueue(threadId, queueId)" />

    <!-- 输入区域 -->
    <ChatInput
      ref="chatInputRef"
      :placeholder="state.isStreaming ? '可继续输入（消息将排队处理）' : '输入消息... (Enter 发送，Shift+Enter 换行)'"
      :disabled="false"
      :show-stop-button="state.isStreaming"
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
