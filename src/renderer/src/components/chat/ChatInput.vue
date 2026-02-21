<script setup lang="ts">
/**
 * ChatInput — 统一的对话输入框组件
 *
 * 支持多行输入、自动高度调整、模型选择等功能。
 */

import { ref, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    disabled?: boolean;
    modelValue?: string;
    showModelSelector?: boolean;
    showStopButton?: boolean;
  }>(),
  {
    placeholder: '输入消息... (Enter 发送)',
    disabled: false,
    modelValue: '',
    showModelSelector: false,
    showStopButton: false
  }
);

const emit = defineEmits<{
  send: [text: string];
  stop: [];
  'update:modelValue': [value: string];
}>();

const inputText = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value)
});

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const modelSelectorOpen = ref(false);

// 可选模型列表（后续可以从配置中读取）
const availableModels = ref([
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek' }
]);

const currentModel = ref(availableModels.value[0]);

// 自动调整高度
function autoResize(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// 发送消息
async function handleSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || props.disabled) return;
  emit('send', text);
  emit('update:modelValue', '');
  resetTextareaHeight();
}

// 重置输入框高度
function resetTextareaHeight(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
}

// 键盘事件
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    handleSend();
  }
}

// 选择模型
function selectModel(model: (typeof availableModels.value)[0]): void {
  currentModel.value = model;
  modelSelectorOpen.value = false;
}

// 暴露给父组件
defineExpose({
  focus: () => textareaRef.value?.focus(),
  clear: () => {
    emit('update:modelValue', '');
    resetTextareaHeight();
  }
});
</script>

<template>
  <div class="chat-input-wrapper">
    <textarea
      ref="textareaRef"
      v-model="inputText"
      class="chat-input"
      :placeholder="placeholder"
      rows="2"
      :disabled="disabled"
      @keydown="handleKeydown"
      @input="autoResize" />

    <!-- 工具栏（右下角） -->
    <div class="chat-input-toolbar">
      <!-- 模型选择器 -->
      <Popover v-if="showModelSelector" v-model:visible="modelSelectorOpen">
        <template #trigger>
          <button class="toolbar-btn" title="选择模型">
            <span class="i-carbon-model inline-block h-3.5 w-3.5" />
            <span class="toolbar-btn-text">{{ currentModel.name }}</span>
            <span class="i-carbon-chevron-down inline-block h-3 w-3" />
          </button>
        </template>
        <template #default>
          <div class="model-selector-popup">
            <div class="model-selector-header">选择模型</div>
            <div class="model-list">
              <div
                v-for="model in availableModels"
                :key="model.id"
                class="model-item"
                :class="{ 'model-item-active': currentModel.id === model.id }"
                @click="selectModel(model)">
                <div class="model-item-content">
                  <span class="model-item-name">{{ model.name }}</span>
                  <span class="model-item-provider">{{ model.provider }}</span>
                </div>
                <span
                  v-if="currentModel.id === model.id"
                  class="i-carbon-checkmark inline-block h-3.5 w-3.5 text-primary" />
              </div>
            </div>
          </div>
        </template>
      </Popover>

      <!-- 停止按钮 -->
      <button v-if="showStopButton" class="toolbar-btn-stop" title="中断" @click="emit('stop')">
        <span class="i-carbon-stop-filled inline-block h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  border-top: 1px solid hsl(var(--border) / 0.25);
  background: hsl(var(--muted) / 0.2);
  transition: background-color 0.15s ease;
}

.chat-input-wrapper:focus-within {
  background: hsl(var(--muted) / 0.3);
}

.chat-input {
  width: 100%;
  min-height: 56px;
  max-height: 200px;
  padding: 10px 12px;
  padding-bottom: 38px; /* 为工具栏留出空间 */
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  overflow-y: auto;
}

.chat-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.4);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-input-toolbar {
  position: absolute;
  bottom: 10px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--background) / 0.8);
  border: 1px solid hsl(var(--border) / 0.3);
  transition: all 0.15s ease;
  cursor: pointer;
}

.toolbar-btn:hover {
  background: hsl(var(--background));
  border-color: hsl(var(--border) / 0.5);
  color: hsl(var(--foreground));
}

.toolbar-btn-text {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-btn-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--error));
  transition: all 0.15s ease;
  cursor: pointer;
}

.toolbar-btn-stop:hover {
  opacity: 0.85;
}

/* 模型选择器弹出框 */
.model-selector-popup {
  width: 280px;
  max-height: 400px;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  box-shadow: 0 4px 20px hsl(var(--shadow) / 0.15);
  overflow: hidden;
}

.model-selector-header {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.model-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.model-item:hover {
  background: hsl(var(--muted) / 0.6);
}

.model-item-active {
  background: hsl(var(--primary) / 0.1);
}

.model-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.model-item-name {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.model-item-provider {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
