<script setup lang="ts">
/**
 * CopilotBubble — 应用管家全局悬浮气泡 + 右侧抽屉面板
 *
 * 右下角悬浮按钮，点击后从右侧滑出全高度抽屉对话面板。
 * 使用 Popup 组件 position="right" + transition="slide-left" 实现。
 *
 * 消息布局：统一靠左，角色标签换行展示，内容平铺不浪费空间。
 */

import { ref, nextTick, watch, computed } from 'vue';
import { useCopilotStore } from '@/stores/copilot';
import type { PendingApproval } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import ChatInput from '@/components/chat/ChatInput.vue';
import { layerManager } from '@/utils/LayerManager';

const copilot = useCopilotStore();
const inputText = ref('');
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);

const drawerVisible = computed({
  get: () => copilot.visible,
  set: (v: boolean) => {
    if (v) copilot.open();
    else copilot.close();
  }
});

const fabZIndex = layerManager.nextZIndex();

const drawerContainerStyle = {
  marginTop: '0',
  marginBottom: '0',
  height: '100%'
};

function scrollToBottom(): void {
  chatMessagesRef.value?.scrollToBottom();
}

watch(
  () => copilot.messages.length,
  () => scrollToBottom()
);
watch(
  () => {
    const msgs = copilot.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

watch(
  () => copilot.visible,
  (v) => {
    if (v) {
      nextTick(() => {
        chatInputRef.value?.focus();
        scrollToBottom();
      });
    }
  }
);

async function handleSend(text: string): Promise<void> {
  if (!text) return;
  scrollToBottom();
  await copilot.sendMessage(text);
}

async function handleStop(): Promise<void> {
  await copilot.abort();
}

function handleApproval(approval: PendingApproval, decision: HitlApprovalDecision): void {
  if (!copilot.sessionId || approval.decision) return;

  // 提交决策到后端
  copilot.submitDecision(copilot.sessionId, approval.index, decision);

  // 添加一条用户消息，显示决策结果
  const decisionText = decision === 'approve-once' ? '已允许' : decision === 'approve-always' ? '始终允许' : '已拒绝';

  copilot.messages.push({
    id: `user-decision-${Date.now()}`,
    role: 'user',
    content: `[${decisionText}执行 ${approval.toolName} 工具]`,
    blocks: [],
    status: 'done',
    timestamp: Date.now()
  });
}
</script>

<template>
  <!-- 悬浮气泡按钮（固定在右下角，工作区内隐藏） -->
  <Transition name="bubble-pop">
    <button
      v-if="!copilot.visible && !copilot.bubbleHidden"
      class="copilot-fab"
      :style="{ zIndex: fabZIndex }"
      title="应用管家"
      @click="copilot.open()">
      <span class="i-mdi-star-four-points inline-block h-5 w-5" />
    </button>
  </Transition>

  <!-- 右侧抽屉面板（Popup 组件） -->
  <Popup
    v-model:visible="drawerVisible"
    position="right"
    transition="slide-left"
    :show-mask="true"
    :close-on-click-overlay="true"
    :close-on-esc="true"
    :lock-scroll="false"
    :container-style="drawerContainerStyle">
    <div class="copilot-drawer">
      <!-- 面板头部 -->
      <div class="panel-header">
        <div class="panel-header-left">
          <span class="i-mdi-star-four-points inline-block h-4 w-4 text-[hsl(var(--primary))]" />
          <span class="panel-title">应用管家</span>
        </div>
        <div class="panel-header-right">
          <button v-if="copilot.hasMessages" class="panel-icon-btn" title="清空对话" @click="copilot.clearMessages()">
            <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
          </button>
          <button class="panel-icon-btn" title="收起" @click="copilot.close()">
            <span class="i-carbon-close inline-block h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- 消息区域 -->
      <ChatMessages
        ref="chatMessagesRef"
        :messages="copilot.messages"
        :is-streaming="copilot.isStreaming"
        @decide="handleApproval">
        <template #empty>
          <div class="panel-empty-icon">
            <span class="i-mdi-star-four-points inline-block h-8 w-8" />
          </div>
          <p class="panel-empty-title">你好，我是应用管家</p>
          <p class="panel-empty-sub">告诉我你想做什么，比如创建技能、管理智能体、修改配置...</p>
          <div class="panel-suggestions">
            <button class="suggestion-btn" @click="copilot.sendMessage('列出所有技能')">列出所有技能</button>
            <button class="suggestion-btn" @click="copilot.sendMessage('列出所有智能体')">列出所有智能体</button>
            <button class="suggestion-btn" @click="copilot.sendMessage('查看当前配置')">查看当前配置</button>
          </div>
        </template>
      </ChatMessages>

      <!-- 输入区域 -->
      <ChatInput
        ref="chatInputRef"
        v-model="inputText"
        :placeholder="copilot.isStreaming ? '处理中...' : '输入消息，Enter 发送'"
        :disabled="copilot.isStreaming"
        :show-model-selector="true"
        :show-stop-button="copilot.isStreaming"
        @send="handleSend"
        @stop="handleStop" />
    </div>
  </Popup>
</template>

<style scoped>
/* ====== 悬浮按钮（固定右下角） ====== */
.copilot-fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow:
    0 4px 14px hsl(var(--primary) / 0.35),
    0 2px 6px hsl(var(--shadow) / 0.15);
  cursor: pointer;
  transition: all 0.2s ease;
}

.copilot-fab:hover {
  transform: scale(1.08);
  box-shadow:
    0 6px 20px hsl(var(--primary) / 0.4),
    0 3px 8px hsl(var(--shadow) / 0.2);
}

.copilot-fab:active {
  transform: scale(0.95);
}

/* ====== 气泡动画 ====== */
.bubble-pop-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bubble-pop-leave-active {
  transition: all 0.15s ease;
}
.bubble-pop-enter-from {
  opacity: 0;
  transform: scale(0.5);
}
.bubble-pop-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* ====== 抽屉内容 ====== */
.copilot-drawer {
  width: 400px;
  height: 100%;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border) / 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ====== 面板头部 ====== */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.8);
  backdrop-filter: blur(8px);
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.panel-header-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.panel-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.12s ease;
}

.panel-icon-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

/* ====== 消息区域 ====== */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  padding: 40px 20px;
}

.panel-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.5);
  margin-bottom: 16px;
}

.panel-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 6px;
}

.panel-empty-sub {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.5;
  max-width: 280px;
}

.panel-suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}

.suggestion-btn {
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.06);
  border: 1px solid hsl(var(--primary) / 0.12);
  transition: all 0.12s ease;
}

.suggestion-btn:hover {
  background: hsl(var(--primary) / 0.12);
  border-color: hsl(var(--primary) / 0.2);
}

/* ====== 消息块 ====== */
.msg-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.msg-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.msg-role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
}

.msg-role-user {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground) / 0.5);
}

.msg-role-assistant {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.msg-role-name {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
}

.msg-time {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.3);
}

.msg-content {
  padding-left: 28px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.85);
  word-break: break-word;
}

.msg-text {
  white-space: pre-wrap;
}

.msg-thinking {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 0;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-style: italic;
}

.msg-thinking-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.msg-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin: 3px 0;
  border-radius: 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.6);
  background: hsl(var(--foreground) / 0.03);
}
</style>
