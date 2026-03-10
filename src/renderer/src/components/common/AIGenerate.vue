<!--
  AIGenerate - AI 生成组件

  用途：为任意 UI 元素提供 AI 生成能力

  设计理念：
  - 通过 slot 接收用户自定义的 UI（如按钮、链接等）
  - 通过 slot props 暴露状态和方法
  - 完全不影响用户的布局和样式
  - 内置弹出框显示生成过程和结果

  使用示例：
  ```vue
  <AIGenerate
    v-slot="{ isGenerating, trigger, result, error }"
    agent="task-analyzer"
    :prompt="buildPrompt"
    @success="handleSuccess"
    @error="handleError">
    <button
      :disabled="isGenerating"
      @click="trigger">
      {{ isGenerating ? 'AI 生成中...' : 'AI 生成' }}
    </button>
  </AIGenerate>
  ```
-->

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { quickChatStream } from '@/composables/useQuickChat';
import Popup from '@/components/Popup/index.vue';

/**
 * 提示词构建函数类型
 */
export type PromptBuilder = string | ((context?: unknown) => string | Promise<string>);

/**
 * 组件 Props
 */
export interface AIGenerateProps {
  /**
   * Agent ID
   * @example 'app-copilot' | 'one-line-summary'
   */
  agent: string;

  /**
   * 提示词或提示词构建函数
   */
  prompt: PromptBuilder;

  /**
   * 是否在触发后自动解析 JSON 结果
   * @default true
   */
  autoParseJson?: boolean;

  /**
   * 是否禁用
   */
  disabled?: boolean;

  /**
   * 取消令牌
   */
  cancelToken?: { cancelled: boolean };

  /**
   * 是否显示内置弹出框
   * @default true
   */
  showDialog?: boolean;

  /**
   * 弹出框标题
   * @default 'AI 生成结果'
   */
  dialogTitle?: string;

  /**
   * 是否需要确认才触发 success 事件
   * @default true
   */
  requireConfirm?: boolean;

  /**
   * 确认按钮文本
   * @default '应用'
   */
  confirmText?: string;
}

/**
 * 组件 Emits
 */
export interface AIGenerateEmits {
  (e: 'start'): void;
  (e: 'success', result: unknown): void;
  (e: 'error', error: string): void;
  (e: 'cancel'): void;
  (e: 'complete'): void;
}

const props = withDefaults(defineProps<AIGenerateProps>(), {
  autoParseJson: true,
  disabled: false,
  showDialog: true,
  dialogTitle: 'AI 生成结果',
  requireConfirm: true,
  confirmText: '应用'
});

const emit = defineEmits<AIGenerateEmits>();

// ==================== 状态管理 ====================

const isGenerating = ref(false);
const result = ref<unknown>(null);
const error = ref<string | null>(null);
const accumulatedContent = ref('');
const generateStatus = ref<'idle' | 'generating' | 'success' | 'error' | 'cancelled'>('idle');
const dialogVisible = ref(false);
const isConfirmed = ref(false);

// ==================== 核心方法 ====================

/**
 * 构建提示词
 */
const buildPrompt = async (context?: unknown): Promise<string> => {
  if (typeof props.prompt === 'function') {
    const result = props.prompt(context);
    return await Promise.resolve(result);
  }
  return props.prompt;
};

/**
 * 去掉代码块包裹（如 ```markdown ... ``` 或 ```json ... ```）
 */
const unwrapCodeBlock = (text: string): string => {
  // 匹配 ```语言名 ... ``` 或 ``` ... ```
  const codeBlockMatch = text.match(/```(?:markdown|json|[a-z]*)\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
};

/**
 * 解析 JSON 结果
 */
const parseJsonResult = (text: string): unknown => {
  try {
    // 先去掉代码块包裹
    const unwrapped = unwrapCodeBlock(text);

    const jsonBlockMatch = unwrapped.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }

    const codeBlockMatch = unwrapped.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      if (content.startsWith('{') || content.startsWith('[')) {
        return JSON.parse(content);
      }
    }

    const jsonObjectMatch = unwrapped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonObjectMatch) {
      return JSON.parse(jsonObjectMatch[1]);
    }

    const trimmedText = unwrapped.trim();
    if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
      return JSON.parse(trimmedText);
    }

    console.warn('[AIGenerate] 未找到有效的 JSON 内容，返回原始文本');
    return unwrapped;
  } catch {
    console.warn('[AIGenerate] JSON 解析失败，返回原始文本');
    return text;
  }
};

/**
 * 触发 AI 生成
 */
const trigger = async (context?: unknown): Promise<void> => {
  if (props.disabled || isGenerating.value) {
    return;
  }

  // 重置状态
  isGenerating.value = true;
  error.value = null;
  result.value = null;
  accumulatedContent.value = '';
  generateStatus.value = 'generating';
  isConfirmed.value = false;

  // 显示弹出框
  if (props.showDialog) {
    dialogVisible.value = true;
  }

  emit('start');

  try {
    const prompt = await buildPrompt(context);
    if (!prompt || !prompt.trim()) {
      throw new Error('提示词不能为空');
    }

    // 使用流式版本，实时更新 accumulatedContent
    const output = await quickChatStream(props.agent, prompt, (chunk: string) => {
      accumulatedContent.value += chunk;
    });

    if (props.cancelToken?.cancelled) {
      generateStatus.value = 'cancelled';
      emit('cancel');
      return;
    }

    if (!output || !output.trim()) {
      throw new Error('AI 返回内容为空');
    }

    // 去掉 Markdown 代码块包裹
    const unwrapped = unwrapCodeBlock(output);
    accumulatedContent.value = unwrapped;

    const parsedResult = props.autoParseJson ? parseJsonResult(unwrapped) : unwrapped;
    result.value = parsedResult;
    generateStatus.value = 'success';

    // 如果不需要确认，立即触发成功事件
    if (!props.requireConfirm) {
      emit('success', parsedResult);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : '生成失败，请稍后重试';
    error.value = errorMessage;
    generateStatus.value = 'error';
    emit('error', errorMessage);
  } finally {
    isGenerating.value = false;
    emit('complete');
  }
};

/**
 * 取消生成
 */
const cancel = (): void => {
  if (isGenerating.value) {
    isGenerating.value = false;
    generateStatus.value = 'cancelled';
    emit('cancel');
  }
};

/**
 * 关闭弹出框
 */
const closeDialog = (): void => {
  dialogVisible.value = false;
  isConfirmed.value = false;
};

/**
 * 确认并应用结果
 */
const confirmResult = (): void => {
  if (result.value !== null && !isConfirmed.value) {
    isConfirmed.value = true;
    emit('success', result.value);
    if (props.showDialog) {
      dialogVisible.value = false;
    }
  }
};

/**
 * 复制结果
 */
const copyResult = async (): Promise<void> => {
  try {
    const textToCopy = typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2);
    await navigator.clipboard.writeText(textToCopy);
  } catch (err) {
    console.error('复制失败:', err);
  }
};

/**
 * 重置状态
 */
const reset = (): void => {
  isGenerating.value = false;
  result.value = null;
  error.value = null;
  accumulatedContent.value = '';
  generateStatus.value = 'idle';
  dialogVisible.value = false;
  isConfirmed.value = false;
};

/**
 * 判断值类型
 */
const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

/**
 * 判断是否为 HTML 内容
 */
const isHtmlContent = (text: string): boolean => {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  const hasHtmlTags = /<[^>]+>/g.test(trimmed);
  const startsWithTag = /^<[^>]+>/i.test(trimmed);
  return hasHtmlTags && startsWithTag;
};

/**
 * 格式化单元格值
 */
const formatCellValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
};

// ==================== 生命周期 ====================

watch(
  () => props.cancelToken?.cancelled,
  (cancelled) => {
    if (cancelled && isGenerating.value) {
      cancel();
    }
  }
);

onUnmounted(() => {
  cancel();
});

// ==================== Slot Props 暴露 ====================

defineExpose({
  isGenerating,
  result,
  error,
  accumulatedContent,
  trigger,
  cancel,
  reset,
  dialogVisible,
  closeDialog,
  confirmResult,
  isConfirmed
});
</script>

<template>
  <!--
    Slot Props:
    - isGenerating: boolean - 是否正在生成
    - result: unknown - 生成结果
    - error: string | null - 错误信息
    - accumulatedContent: string - 累积的文本内容
    - trigger: (context?: unknown) => Promise<void> - 触发生成的方法
    - cancel: () => void - 取消生成的方法
    - reset: () => void - 重置状态的方法
    - dialogVisible: Ref<boolean> - 弹窗可见性
    - closeDialog: () => void - 关闭弹窗的方法
    - confirmResult: () => void - 确认并应用结果的方法
    - isConfirmed: Ref<boolean> - 是否已确认
  -->
  <slot
    :is-generating="isGenerating"
    :result="result"
    :error="error"
    :accumulated-content="accumulatedContent"
    :trigger="trigger"
    :cancel="cancel"
    :reset="reset"
    :dialog-visible="dialogVisible"
    :close-dialog="closeDialog"
    :confirm-result="confirmResult"
    :is-confirmed="isConfirmed" />

  <!-- 内置弹出框 -->
  <Popup
    :visible="dialogVisible && showDialog"
    position="center"
    :show-mask="true"
    :close-on-click-overlay="false"
    :close-on-esc="false"
    transition="zoom"
    @update:visible="dialogVisible = $event">
    <div class="dialog-container">
      <!-- 头部 -->
      <div class="dialog-header">
        <div class="flex items-center space-x-3">
          <!-- 状态图标 -->
          <div class="status-icon-wrapper" :class="`status-${generateStatus}`">
            <i
              class="w-5 h-5"
              :class="{
                'i-mdi-loading animate-spin': generateStatus === 'generating',
                'i-mdi-check-circle': generateStatus === 'success',
                'i-mdi-alert-circle': generateStatus === 'error',
                'i-mdi-cancel': generateStatus === 'cancelled'
              }" />
          </div>

          <!-- 标题 -->
          <div>
            <h3 class="dialog-title">{{ dialogTitle }}</h3>
            <p class="dialog-subtitle">
              {{
                generateStatus === 'generating'
                  ? 'AI 正在处理中...'
                  : generateStatus === 'success'
                    ? '生成完成'
                    : generateStatus === 'error'
                      ? '生成失败'
                      : '已取消'
              }}
            </p>
          </div>
        </div>

        <!-- 关闭按钮 -->
        <button class="dialog-close-btn" @click="closeDialog">
          <i class="i-mdi-close w-5 h-5" />
        </button>
      </div>

      <!-- 内容区域 -->
      <div class="dialog-content">
        <!-- 生成中 -->
        <div v-if="generateStatus === 'generating'">
          <!-- 流式内容展示 -->
          <div v-if="accumulatedContent" class="streaming-content">
            <div class="streaming-indicator">
              <i class="i-mdi-loading animate-spin w-4 h-4 status-generating-icon" />
              <span class="streaming-text">AI 正在生成中...</span>
            </div>
            <div class="streaming-text-content">
              {{ accumulatedContent }}
            </div>
          </div>
          <!-- 初始加载状态 -->
          <div v-else class="generating-state">
            <i class="i-mdi-loading animate-spin w-12 h-12 status-generating-icon" />
            <div class="text-center space-y-2">
              <p class="generating-text">AI 正在生成中...</p>
              <p class="generating-hint">正在解析数据，请稍候</p>
            </div>
          </div>
        </div>

        <!-- 生成成功 -->
        <div v-else-if="generateStatus === 'success' && result" class="space-y-4">
          <!-- JSON 数组展示 -->
          <div v-if="getValueType(result) === 'array'" class="space-y-3">
            <div v-for="(item, index) in result as unknown[]" :key="index" class="result-item">
              <div class="result-item-header">
                <span class="result-item-index">第 {{ index + 1 }} 项</span>
              </div>
              <div class="space-y-2">
                <div
                  v-for="(value, key) in item as Record<string, unknown>"
                  :key="String(key)"
                  class="flex flex-col space-y-1">
                  <span class="result-key">{{ key }}</span>
                  <span class="result-value">{{ formatCellValue(value) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- JSON 对象展示 -->
          <div v-else-if="getValueType(result) === 'object'" class="space-y-2">
            <div v-for="(value, key) in result as Record<string, unknown>" :key="String(key)" class="result-item">
              <div class="flex flex-col space-y-1">
                <span class="result-key">{{ key }}</span>
                <span class="result-value">{{ formatCellValue(value) }}</span>
              </div>
            </div>
          </div>

          <!-- 纯文本/HTML 展示 -->
          <div v-else>
            <div class="result-header">
              <div class="flex items-center space-x-2">
                <i
                  :class="isHtmlContent(String(result)) ? 'i-mdi-language-html5' : 'i-mdi-text'"
                  class="w-4 h-4 result-header-icon" />
                <span class="result-header-title">{{ isHtmlContent(String(result)) ? 'HTML 内容' : '生成结果' }}</span>
              </div>
              <button class="copy-btn" @click="copyResult">
                <i class="i-mdi-content-copy w-3.5 h-3.5" />
                <span>复制</span>
              </button>
            </div>

            <!-- HTML 内容渲染 -->
            <div v-if="isHtmlContent(String(result))" class="space-y-3">
              <div class="html-preview">
                <div class="prose-content">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <div v-html="String(result)"></div>
                </div>
              </div>

              <!-- HTML 源代码 -->
              <details class="group">
                <summary class="html-source-summary">
                  <div class="flex items-center space-x-2">
                    <i class="i-mdi-code-tags w-4 h-4" />
                    <span class="html-source-label">查看源代码</span>
                  </div>
                  <i class="i-mdi-chevron-down w-4 h-4 group-open:rotate-180 transition-transform" />
                </summary>
                <div class="html-source-code">
                  {{ result }}
                </div>
              </details>
            </div>

            <!-- 纯文本内容 -->
            <div v-else class="text-content">
              {{ result }}
            </div>
          </div>
        </div>

        <!-- 生成失败 -->
        <div v-else-if="generateStatus === 'error'" class="space-y-4">
          <div class="error-banner">
            <i class="i-mdi-alert-circle w-5 h-5 flex-shrink-0 mt-0.5" />
            <div class="flex-1">
              <h4 class="error-title">生成失败</h4>
              <p class="error-message">{{ error }}</p>
            </div>
          </div>

          <!-- 部分内容 -->
          <div v-if="accumulatedContent" class="space-y-2">
            <span class="partial-label">部分生成内容：</span>
            <div class="partial-content">
              {{ accumulatedContent }}
            </div>
          </div>
        </div>

        <!-- 已取消 -->
        <div v-else-if="generateStatus === 'cancelled'" class="space-y-4">
          <div class="cancelled-banner">
            <i class="i-mdi-information w-5 h-5 flex-shrink-0 mt-0.5" />
            <div class="flex-1">
              <h4 class="cancelled-title">生成已取消</h4>
              <p class="cancelled-message">AI 生成任务已被手动取消</p>
            </div>
          </div>

          <!-- 已生成内容 -->
          <div v-if="accumulatedContent" class="space-y-2">
            <span class="partial-label">已生成内容：</span>
            <div class="partial-content">
              {{ accumulatedContent }}
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="dialog-footer">
        <!-- 生成中 - 取消按钮 -->
        <button v-if="generateStatus === 'generating'" class="action-btn action-cancel" @click="cancel">
          <i class="i-mdi-cancel w-4 h-4 mr-1.5 inline-block" />
          取消生成
        </button>

        <!-- 生成成功 - 需要确认模式 -->
        <template v-else-if="generateStatus === 'success' && requireConfirm">
          <button class="action-btn action-secondary" @click="closeDialog">取消</button>
          <button class="action-btn action-primary" :disabled="isConfirmed" @click="confirmResult">
            <i class="i-mdi-check w-4 h-4" />
            <span>{{ isConfirmed ? '已应用' : confirmText }}</span>
          </button>
        </template>

        <!-- 生成完成 - 普通模式 -->
        <button v-else class="action-btn action-default" @click="closeDialog">关闭</button>
      </div>
    </div>
  </Popup>
</template>

<style scoped>
.dialog-container {
  width: 100%;
  max-width: 48rem;
  background: hsl(var(--background));
  border-radius: 12px;
  box-shadow:
    0 20px 50px hsl(var(--shadow) / 0.15),
    0 8px 20px hsl(var(--shadow) / 0.1);
  border: 1px solid hsl(var(--border) / 0.4);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.4);
  flex-shrink: 0;
}

.status-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-generating {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.status-success {
  background: hsl(142 71% 45% / 0.1);
  color: hsl(142 71% 45%);
}

.status-error {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.status-cancelled {
  background: hsl(45 93% 47% / 0.1);
  color: hsl(45 93% 47%);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.dialog-subtitle {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.7);
}

.dialog-close-btn {
  padding: 8px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.15s ease;
}

.dialog-close-btn:hover {
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--foreground));
}

.dialog-content {
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.generating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  gap: 16px;
}

.streaming-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: hsl(var(--primary) / 0.08);
  border-radius: 8px;
  border: 1px solid hsl(var(--primary) / 0.2);
}

.streaming-text {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary));
}

.streaming-text-content {
  padding: 16px;
  background: hsl(var(--muted) / 0.1);
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.25);
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 50vh;
  overflow-y: auto;
}

.status-generating-icon {
  color: hsl(var(--primary));
}

.generating-text {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.generating-hint {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.7);
}

.result-item {
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.5);
  transition: all 0.15s ease;
}

.result-item:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.5);
}

.result-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
}

.result-item-index {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--primary));
}

.result-key {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.result-value {
  font-size: 13px;
  color: hsl(var(--foreground));
  word-break: break-word;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.result-header-icon {
  color: hsl(var(--muted-foreground) / 0.6);
}

.result-header-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  border-radius: 6px;
  transition: all 0.15s ease;
}

.copy-btn:hover {
  background: hsl(var(--primary) / 0.15);
}

.html-preview {
  padding: 16px;
  background: hsl(var(--background));
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.3);
}

.prose-content {
  max-width: none;
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.6;
}

.prose-content :deep(h1),
.prose-content :deep(h2),
.prose-content :deep(h3) {
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-top: 16px;
  margin-bottom: 8px;
}

.prose-content :deep(h1) {
  font-size: 24px;
}

.prose-content :deep(h2) {
  font-size: 20px;
}

.prose-content :deep(h3) {
  font-size: 16px;
}

.prose-content :deep(p) {
  margin: 8px 0;
  line-height: 1.6;
}

.prose-content :deep(ul),
.prose-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.prose-content :deep(ul) {
  list-style-type: disc;
}

.prose-content :deep(ol) {
  list-style-type: decimal;
}

.prose-content :deep(li) {
  margin: 4px 0;
}

.prose-content :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: hsl(var(--muted) / 0.3);
  font-family: var(--font-family-mono);
  font-size: 12px;
}

.prose-content :deep(pre) {
  padding: 16px;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.3);
  overflow-x: auto;
  margin: 12px 0;
}

.prose-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.prose-content :deep(blockquote) {
  border-left: 4px solid hsl(var(--primary));
  padding-left: 16px;
  font-style: italic;
  margin: 12px 0;
}

.prose-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}

.prose-content :deep(th),
.prose-content :deep(td) {
  border: 1px solid hsl(var(--border) / 0.3);
  padding: 8px 12px;
  text-align: left;
}

.prose-content :deep(th) {
  background: hsl(var(--muted) / 0.3);
  font-weight: 600;
}

.prose-content :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
}

.prose-content :deep(a):hover {
  opacity: 0.8;
}

.html-source-summary {
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  background: hsl(var(--surface) / 0.4);
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.3);
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: hsl(var(--muted-foreground));
}

.html-source-summary:hover {
  background: hsl(var(--surface) / 0.6);
}

.html-source-label {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.html-source-code {
  margin-top: 8px;
  padding: 16px;
  background: hsl(var(--muted) / 0.2);
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.3);
  font-family: var(--font-family-mono);
  font-size: 12px;
  white-space: pre-wrap;
  color: hsl(var(--foreground));
  line-height: 1.5;
  overflow-x: auto;
}

.text-content {
  padding: 16px;
  background: hsl(var(--muted) / 0.2);
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.3);
  font-family: var(--font-family-mono);
  font-size: 13px;
  white-space: pre-wrap;
  color: hsl(var(--foreground));
  line-height: 1.5;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: hsl(var(--error) / 0.08);
  border: 1px solid hsl(var(--error) / 0.2);
  border-radius: 8px;
  color: hsl(var(--error));
}

.error-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.error-message {
  font-size: 13px;
  opacity: 0.8;
}

.cancelled-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: hsl(45 93% 47% / 0.08);
  border: 1px solid hsl(45 93% 47% / 0.2);
  border-radius: 8px;
  color: hsl(45 93% 47%);
}

.cancelled-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.cancelled-message {
  font-size: 13px;
  opacity: 0.8;
}

.partial-label {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.partial-content {
  padding: 16px;
  background: hsl(var(--muted) / 0.15);
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.25);
  font-family: var(--font-family-mono);
  font-size: 13px;
  white-space: pre-wrap;
  color: hsl(var(--foreground));
  max-height: 240px;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.4);
  flex-shrink: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.action-cancel {
  color: hsl(var(--error));
  border: 1px solid hsl(var(--error) / 0.3);
  background: transparent;
}

.action-cancel:hover {
  background: hsl(var(--error) / 0.08);
}

.action-secondary {
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--surface));
}

.action-secondary:hover {
  background: hsl(var(--muted) / 0.3);
  border-color: hsl(var(--border) / 0.6);
}

.action-primary {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  border: none;
}

.action-primary:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
}

.action-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-default {
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.3);
  border: none;
}

.action-default:hover {
  background: hsl(var(--muted) / 0.5);
}
</style>
