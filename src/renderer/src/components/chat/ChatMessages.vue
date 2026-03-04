<script setup lang="ts">
/**
 * ChatMessages — 统一对话消息列表组件
 *
 * 封装了优秀的消息排版布局，负责消息的整体渲染与自动滚动控制。
 */

import { ref, computed, watch, nextTick, onMounted } from 'vue';
import type { ContentBlock, PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import MessageItemUser from './items/MessageItemUser.vue';
import MessageItemAssistant from './items/MessageItemAssistant.vue';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  status?: string;
  timestamp: number;
  error?: string;
  pendingApprovals?: PendingApproval[];
}

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    isStreaming?: boolean;
  }>(),
  {
    isStreaming: false
  }
);

const emit = defineEmits<{
  decide: [approval: PendingApproval, decision: HitlApprovalDecision];
}>();

const currentActivity = computed<string>(() => {
  if (!props.isStreaming || props.messages.length === 0) return '处理中...';
  const last = props.messages[props.messages.length - 1];
  if (last.role !== 'assistant' || !last.blocks?.length) return '思考中...';
  const lastBlock = last.blocks[last.blocks.length - 1];
  if (lastBlock.type === 'tool' && 'tool' in lastBlock) {
    const toolName = lastBlock.tool.name;
    if (lastBlock.tool.status === 'calling') return `执行 ${toolName}...`;
    if (lastBlock.tool.status === 'approval-pending') return `等待审批 ${toolName}...`;
  }
  if (lastBlock.type === 'thinking') return '推理中...';
  if (lastBlock.type === 'delegate' && 'delegate' in lastBlock) {
    return `委派给 ${lastBlock.delegate.agentName || '子智能体'}...`;
  }
  return '生成中...';
});

const messageContainer = ref<HTMLElement | null>(null);

// ========== 智能滚动：用户往上浏览时不强制拉回底部 ==========
const userScrolledUp = ref(false);

function isNearBottom(): boolean {
  const el = messageContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function handleScroll(): void {
  userScrolledUp.value = !isNearBottom();
}

function scrollToBottom(force = false): void {
  if (!force && userScrolledUp.value) return;
  nextTick(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
      userScrolledUp.value = false;
    }
  });
}

defineExpose({
  scrollToBottom
});

// 监听消息数量变化（新消息到达）
watch(
  () => props.messages.length,
  (newLen, oldLen) => {
    // 如果是首次加载历史消息（从 0 到有），强制滚动到底部
    if (oldLen === 0 && newLen > 0) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }
);

// 监听流式内容增量更新
watch(
  () => {
    const msgs = props.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 && last.blocks ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

onMounted(() => {
  scrollToBottom(true);
});
</script>

<template>
  <div ref="messageContainer" class="panel-messages selectable" @scroll="handleScroll">
    <!-- 空状态 -->
    <div v-if="messages.length === 0" class="panel-empty">
      <slot name="empty">
        <div class="panel-empty-icon">
          <span class="i-mdi-star-four-points inline-block h-8 w-8" />
        </div>
        <p class="panel-empty-title">有什么可以帮您？</p>
        <p class="panel-empty-sub">输入消息开始对话</p>
      </slot>
    </div>

    <!-- 消息列表 -->
    <template v-for="msg in messages" :key="msg.id">
      <MessageItemUser v-if="msg.role === 'user'" :message="msg" />
      <MessageItemAssistant
        v-else
        :message="msg"
        @decide="(approval, decision) => emit('decide', approval, decision)" />
    </template>

    <div v-if="isStreaming" class="stream-indicator">
      <span class="relative flex h-2 w-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60"></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
      </span>
      <span class="ml-1.5 text-xs font-medium text-muted-foreground">{{ currentActivity }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ====== 消息区域样式 ====== */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
}

/* 空状态 */
.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 32px;
  opacity: 0.8;
}

.panel-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  margin-bottom: 20px;
}

.panel-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.panel-empty-sub {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
}

.stream-indicator {
  padding: 6px 16px 12px;
  display: flex;
  align-items: center;
  color: hsl(var(--muted-foreground) / 0.5);
}
</style>
