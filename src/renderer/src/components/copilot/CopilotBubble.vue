<script setup lang="ts">
/**
 * CopilotBubble — 应用管家全局悬浮气泡
 *
 * 右下角悬浮按钮 + 展开的 mini 对话面板。
 * 所有页面可见，点击即可与「应用管家」Agent 对话。
 *
 * 消息布局：统一靠左，角色标签换行展示，内容平铺不浪费空间。
 */

import { ref, nextTick, watch } from 'vue';
import { useCopilotStore, type CopilotBlock } from '@/stores/copilot';

const copilot = useCopilotStore();
const inputText = ref('');
const messageContainer = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

/** 滚动到底部 */
function scrollToBottom(): void {
  nextTick(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
  });
}

// 新消息自动滚动
watch(
  () => copilot.messages.length,
  () => scrollToBottom()
);
// 流式内容更新自动滚动
watch(
  () => {
    const last = copilot.messages[copilot.messages.length - 1];
    return last?.role === 'assistant' ? last.content.length : 0;
  },
  () => scrollToBottom()
);

/** 打开面板时聚焦输入框 */
watch(
  () => copilot.visible,
  (v) => {
    if (v) {
      nextTick(() => {
        textareaRef.value?.focus();
        scrollToBottom();
      });
    }
  }
);

async function handleSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  await copilot.sendMessage(text);
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

/** 渲染工具块摘要 */
function toolSummary(block: CopilotBlock): string {
  if (block.type === 'tool') return `调用 ${block.tool.name}...`;
  return '';
}
</script>

<template>
  <div class="copilot-root">
    <!-- 悬浮气泡按钮 -->
    <Transition name="bubble-pop">
      <button v-if="!copilot.visible" class="copilot-fab" title="应用管家" @click="copilot.open()">
        <span class="i-carbon-sparkle inline-block h-5 w-5" />
      </button>
    </Transition>

    <!-- Mini 对话面板 -->
    <Transition name="panel-slide">
      <div v-if="copilot.visible" class="copilot-panel">
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="panel-header-left">
            <span class="i-carbon-sparkle inline-block h-4 w-4 text-[hsl(var(--primary))]" />
            <span class="panel-title">应用管家</span>
          </div>
          <div class="panel-header-right">
            <button v-if="copilot.hasMessages" class="panel-icon-btn" title="清空对话" @click="copilot.clearMessages()">
              <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
            </button>
            <button class="panel-icon-btn" title="收起" @click="copilot.close()">
              <span class="i-carbon-chevron-down inline-block h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- 消息区域 -->
        <div ref="messageContainer" class="panel-messages">
          <!-- 空状态 -->
          <div v-if="!copilot.hasMessages" class="panel-empty">
            <div class="panel-empty-icon">
              <span class="i-carbon-sparkle inline-block h-6 w-6" />
            </div>
            <p class="panel-empty-title">你好，我是应用管家</p>
            <p class="panel-empty-sub"> 告诉我你想做什么，比如创建技能、管理智能体、修改配置... </p>
            <div class="panel-suggestions">
              <button class="suggestion-btn" @click="copilot.sendMessage('列出所有技能')"> 列出所有技能 </button>
              <button class="suggestion-btn" @click="copilot.sendMessage('列出所有智能体')"> 列出所有智能体 </button>
              <button class="suggestion-btn" @click="copilot.sendMessage('查看当前配置')"> 查看当前配置 </button>
            </div>
          </div>

          <!-- 消息列表 -->
          <template v-for="msg in copilot.messages" :key="msg.id">
            <div class="msg-block">
              <!-- 角色行：图标 + 角色名 + 时间 -->
              <div class="msg-role-row">
                <span class="msg-role-icon" :class="msg.role === 'user' ? 'msg-role-user' : 'msg-role-assistant'">
                  <span
                    class="inline-block h-3 w-3"
                    :class="msg.role === 'user' ? 'i-carbon-user' : 'i-carbon-sparkle'" />
                </span>
                <span class="msg-role-name">{{ msg.role === 'user' ? '你' : '管家' }}</span>
                <span class="msg-time">{{
                  new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                }}</span>
              </div>

              <!-- 用户消息内容 -->
              <div v-if="msg.role === 'user'" class="msg-content">
                <div class="msg-text">{{ msg.content }}</div>
              </div>

              <!-- 助手消息内容 -->
              <div v-else class="msg-content">
                <template v-if="msg.blocks.length > 0">
                  <template v-for="(block, idx) in msg.blocks" :key="idx">
                    <!-- 文本块 -->
                    <div v-if="block.type === 'text'" class="msg-text" v-text="block.text" />

                    <!-- 思考块 -->
                    <div v-else-if="block.type === 'thinking'" class="msg-thinking">
                      <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
                      <span class="msg-thinking-text">{{ block.text }}</span>
                    </div>

                    <!-- 工具调用块 -->
                    <div v-else-if="block.type === 'tool'" class="msg-tool">
                      <span
                        class="inline-block h-3 w-3 shrink-0"
                        :class="
                          block.tool.status === 'calling'
                            ? 'i-carbon-renew animate-spin'
                            : block.tool.status === 'done'
                              ? 'i-carbon-checkmark'
                              : 'i-carbon-warning-alt'
                        " />
                      <span>{{ toolSummary(block) }}</span>
                    </div>
                  </template>
                </template>

                <!-- 流式中无内容的占位 -->
                <div v-else-if="msg.status === 'streaming'" class="msg-typing">
                  <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
                </div>

                <!-- 错误 -->
                <div v-if="msg.status === 'error' && msg.error" class="msg-error">
                  <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                  {{ msg.error }}
                </div>
              </div>
            </div>
          </template>

          <!-- 流式进行中指示 -->
          <div v-if="copilot.isStreaming" class="stream-indicator">
            <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="panel-input-area">
          <textarea
            ref="textareaRef"
            v-model="inputText"
            class="panel-input"
            placeholder="告诉管家你需要什么..."
            rows="1"
            :disabled="copilot.isStreaming"
            @keydown="handleKeydown" />
          <button class="panel-send-btn" :disabled="!inputText.trim() || copilot.isStreaming" @click="handleSend">
            <span
              v-if="copilot.isStreaming"
              class="i-carbon-stop-filled inline-block h-3.5 w-3.5"
              @click.stop="copilot.abort()" />
            <span v-else class="i-carbon-send-filled inline-block h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ====== 根容器 ====== */
.copilot-root {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
}

/* ====== 悬浮按钮 ====== */
.copilot-fab {
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

/* ====== 面板 ====== */
.copilot-panel {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 380px;
  height: 520px;
  border-radius: 16px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border) / 0.5);
  box-shadow:
    0 12px 40px hsl(var(--shadow) / 0.2),
    0 4px 12px hsl(var(--shadow) / 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 面板滑入动画 */
.panel-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.panel-slide-leave-active {
  transition: all 0.2s ease;
}
.panel-slide-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.95);
}
.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

/* ====== 面板头部 ====== */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 14px;
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
  font-size: 13px;
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
  width: 28px;
  height: 28px;
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
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 空状态 */
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  padding: 20px 0;
}

.panel-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.5);
  margin-bottom: 12px;
}

.panel-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 4px;
}

.panel-empty-sub {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.5;
  max-width: 240px;
}

.panel-suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
}

.suggestion-btn {
  padding: 5px 10px;
  border-radius: 14px;
  font-size: 11px;
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

/* ====== 消息块（统一靠左，角色换行） ====== */
.msg-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 角色行 */
.msg-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.msg-role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
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

/* 消息内容区（全宽） */
.msg-content {
  padding-left: 26px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.85);
  word-break: break-word;
}

/* 文本块 */
.msg-text {
  white-space: pre-wrap;
}

/* 思考块 */
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

/* 工具调用块 */
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

/* 打字指示 */
.msg-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: hsl(var(--muted-foreground) / 0.3);
  animation: typing-bounce 1.2s ease-in-out infinite;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-4px);
  }
}

/* 错误 */
.msg-error {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 4px 0;
  font-size: 11px;
  color: hsl(var(--error));
}

/* 流式指示 */
.stream-indicator {
  display: flex;
  justify-content: center;
  padding: 4px;
  color: hsl(var(--primary) / 0.4);
}

/* ====== 输入区域 ====== */
.panel-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.5);
}

.panel-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s ease;
  max-height: 80px;
  overflow-y: auto;
}

.panel-input:focus {
  border-color: hsl(var(--primary) / 0.4);
}

.panel-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.35);
}

.panel-input:disabled {
  opacity: 0.5;
}

.panel-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  flex-shrink: 0;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.panel-send-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.panel-send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
