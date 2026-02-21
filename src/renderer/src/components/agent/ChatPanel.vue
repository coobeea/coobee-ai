<script setup lang="ts">
/**
 * ChatPanel — 对话面板（右栏）
 *
 * Agent 的对话交互区域：消息流、工具调用、HITL 审批。
 * 从原 ChatView.vue 提取，适配窄面板布局。
 */

import { ref, watch, onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import { gateway } from '@/plugins/gatewaySetup';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import ChatInput from '@/components/chat/ChatInput.vue';

const chatStore = useChatStore();
const inputText = ref('');
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

function scrollToBottom(force = false): void {
  chatMessagesRef.value?.scrollToBottom(force);
}

// 新消息到达 → 自动滚动（除非用户在看上面的内容）
watch(
  () => chatStore.messages.length,
  () => scrollToBottom()
);

// 流式内容增量更新 → 自动滚动（除非用户在看上面的内容）
watch(
  () => {
    const msgs = chatStore.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

async function handleSend(text: string): Promise<void> {
  if (!text) return;

  // 用户发送消息 → 强制滚到底部（要看回复）
  scrollToBottom(true);
  await chatStore.sendMessage(text);
}

async function handleStop(): Promise<void> {
  await chatStore.abortSession();
}

function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (!chatStore.sessionId || approval.decision) return;

  // 提交决策到后端
  chatStore.submitDecision(chatStore.sessionId, approval.index, decision);

  // 添加一条用户消息，显示决策结果
  const decisionText = decision === 'approve-once' ? '已允许' : decision === 'approve-always' ? '始终允许' : '已拒绝';

  chatStore.messages.push({
    id: `user-decision-${Date.now()}`,
    role: 'user',
    content: `[${decisionText}执行 ${approval.toolName} 工具]`,
    blocks: [],
    status: 'done',
    timestamp: Date.now()
  });
}

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <aside v-show="!isCollapsed" class="flex h-full w-[320px] shrink-0 flex-col border-l border-gray-200/80 bg-[#f7f7f8]">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-chat inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">对话</span>
      </div>
    </div>

    <!-- 消息区域 -->
    <ChatMessages
      ref="chatMessagesRef"
      :messages="chatStore.messages"
      :is-streaming="chatStore.isStreaming"
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
      v-if="chatStore.isQueued && chatStore.queueStatus"
      class="flex items-center gap-1.5 border-t border-amber-200/80 bg-amber-50/60 px-3 py-1.5">
      <span class="i-carbon-queue inline-block h-3 w-3 text-amber-500"></span>
      <span class="text-[10px] text-amber-600">
        消息已排队 (位置:
        {{ chatStore.queueStatus.queueLength }})
      </span>
    </div>

    <!-- 输入区域 -->
    <ChatInput
      ref="chatInputRef"
      v-model="inputText"
      :placeholder="chatStore.isStreaming ? '可继续输入（消息将排队处理）' : '输入消息... (Enter 发送)'"
      :disabled="false"
      :show-model-selector="true"
      :show-stop-button="chatStore.isStreaming"
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
