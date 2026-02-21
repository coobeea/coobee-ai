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
import { quickChat } from '@/composables/useQuickChat';
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
   * @example 'task-analyzer' | 'title-generator'
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
 * 解析 JSON 结果
 */
const parseJsonResult = (text: string): unknown => {
  try {
    const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }

    const codeBlockMatch = text.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      if (content.startsWith('{') || content.startsWith('[')) {
        return JSON.parse(content);
      }
    }

    const jsonObjectMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonObjectMatch) {
      return JSON.parse(jsonObjectMatch[1]);
    }

    const trimmedText = text.trim();
    if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
      return JSON.parse(trimmedText);
    }

    console.warn('[AIGenerate] 未找到有效的 JSON 内容，返回原始文本');
    return text;
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

    const output = await quickChat(props.agent, prompt);

    if (props.cancelToken?.cancelled) {
      generateStatus.value = 'cancelled';
      emit('cancel');
      return;
    }

    if (!output || !output.trim()) {
      throw new Error('AI 返回内容为空');
    }

    accumulatedContent.value = output;

    const parsedResult = props.autoParseJson ? parseJsonResult(output) : output;
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
    <div
      class="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700">
      <!-- 头部 -->
      <div
        class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
        <div class="flex items-center space-x-3">
          <!-- 状态图标 -->
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center"
            :class="{
              'bg-blue-50 dark:bg-blue-900/20': generateStatus === 'generating',
              'bg-green-50 dark:bg-green-900/20': generateStatus === 'success',
              'bg-red-50 dark:bg-red-900/20': generateStatus === 'error',
              'bg-yellow-50 dark:bg-yellow-900/20': generateStatus === 'cancelled'
            }">
            <i
              class="w-5 h-5"
              :class="{
                'i-mdi-loading animate-spin text-blue-500': generateStatus === 'generating',
                'i-mdi-check-circle text-green-500': generateStatus === 'success',
                'i-mdi-alert-circle text-red-500': generateStatus === 'error',
                'i-mdi-cancel text-yellow-500': generateStatus === 'cancelled'
              }" />
          </div>

          <!-- 标题 -->
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ dialogTitle }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">
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
        <button
          class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          @click="closeDialog">
          <i class="i-mdi-close w-5 h-5" />
        </button>
      </div>

      <!-- 内容区域 -->
      <div class="p-6 max-h-[60vh] overflow-y-auto">
        <!-- 生成中 -->
        <div v-if="generateStatus === 'generating'" class="flex flex-col items-center justify-center py-12 space-y-4">
          <i class="i-mdi-loading animate-spin w-12 h-12 text-blue-500" />
          <div class="text-center space-y-2">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">AI 正在生成中...</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">正在解析数据，请稍候</p>
          </div>
        </div>

        <!-- 生成成功 -->
        <div v-else-if="generateStatus === 'success' && result" class="space-y-4">
          <!-- JSON 数组展示 -->
          <div v-if="getValueType(result) === 'array'" class="space-y-3">
            <div
              v-for="(item, index) in result as unknown[]"
              :key="index"
              class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <div class="flex items-center space-x-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
                <span class="text-xs font-semibold text-blue-500">第 {{ index + 1 }} 项</span>
              </div>
              <div class="space-y-2">
                <div
                  v-for="(value, key) in item as Record<string, unknown>"
                  :key="String(key)"
                  class="flex flex-col space-y-1">
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ key }}</span>
                  <span class="text-sm text-gray-900 dark:text-gray-100 break-words">{{ formatCellValue(value) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- JSON 对象展示 -->
          <div v-else-if="getValueType(result) === 'object'" class="space-y-2">
            <div
              v-for="(value, key) in result as Record<string, unknown>"
              :key="String(key)"
              class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <div class="flex flex-col space-y-1">
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ key }}</span>
                <span class="text-sm text-gray-900 dark:text-gray-100 break-words">{{ formatCellValue(value) }}</span>
              </div>
            </div>
          </div>

          <!-- 纯文本/HTML 展示 -->
          <div v-else>
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center space-x-2">
                <i
                  :class="isHtmlContent(String(result)) ? 'i-mdi-language-html5' : 'i-mdi-text'"
                  class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{
                  isHtmlContent(String(result)) ? 'HTML 内容' : '生成结果'
                }}</span>
              </div>
              <button
                class="px-3 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors flex items-center space-x-1.5"
                @click="copyResult">
                <i class="i-mdi-content-copy w-3.5 h-3.5" />
                <span>复制</span>
              </button>
            </div>

            <!-- HTML 内容渲染 -->
            <div v-if="isHtmlContent(String(result))" class="space-y-3">
              <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="prose prose-sm max-w-none dark:prose-invert">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <div v-html="String(result)"></div>
                </div>
              </div>

              <!-- HTML 源代码 -->
              <details class="group">
                <summary
                  class="cursor-pointer select-none px-3 py-2 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    <i class="i-mdi-code-tags w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <span class="text-xs font-medium text-gray-900 dark:text-gray-100">查看源代码</span>
                  </div>
                  <i
                    class="i-mdi-chevron-down w-4 h-4 text-gray-500 dark:text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div
                  class="mt-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-xs whitespace-pre-wrap text-gray-900 dark:text-gray-100 leading-relaxed overflow-x-auto">
                  {{ result }}
                </div>
              </details>
            </div>

            <!-- 纯文本内容 -->
            <div
              v-else
              class="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100 leading-relaxed">
              {{ result }}
            </div>
          </div>
        </div>

        <!-- 生成失败 -->
        <div v-else-if="generateStatus === 'error'" class="space-y-4">
          <div
            class="flex items-start space-x-3 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
            <i class="i-mdi-alert-circle w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-red-600 dark:text-red-400 mb-1">生成失败</h4>
              <p class="text-sm text-red-500 dark:text-red-400/80">{{ error }}</p>
            </div>
          </div>

          <!-- 部分内容 -->
          <div v-if="accumulatedContent" class="space-y-2">
            <span class="text-sm font-medium text-gray-500 dark:text-gray-400">部分生成内容：</span>
            <div
              class="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100 max-h-60 overflow-y-auto">
              {{ accumulatedContent }}
            </div>
          </div>
        </div>

        <!-- 已取消 -->
        <div v-else-if="generateStatus === 'cancelled'" class="space-y-4">
          <div
            class="flex items-start space-x-3 p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded-lg">
            <i class="i-mdi-information w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">生成已取消</h4>
              <p class="text-sm text-yellow-500 dark:text-yellow-400/80">AI 生成任务已被手动取消</p>
            </div>
          </div>

          <!-- 已生成内容 -->
          <div v-if="accumulatedContent" class="space-y-2">
            <span class="text-sm font-medium text-gray-500 dark:text-gray-400">已生成内容：</span>
            <div
              class="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100 max-h-60 overflow-y-auto">
              {{ accumulatedContent }}
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div
        class="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
        <!-- 生成中 - 取消按钮 -->
        <button
          v-if="generateStatus === 'generating'"
          class="px-4 py-2 text-sm font-medium text-red-500 border border-red-200 dark:border-red-900/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
          @click="cancel">
          <i class="i-mdi-cancel w-4 h-4 mr-1.5 inline-block" />
          取消生成
        </button>

        <!-- 生成成功 - 需要确认模式 -->
        <template v-else-if="generateStatus === 'success' && requireConfirm">
          <button
            class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            @click="closeDialog">
            取消
          </button>
          <button
            class="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors flex items-center space-x-1.5"
            :disabled="isConfirmed"
            @click="confirmResult">
            <i class="i-mdi-check w-4 h-4" />
            <span>{{ isConfirmed ? '已应用' : confirmText }}</span>
          </button>
        </template>

        <!-- 生成完成 - 普通模式 -->
        <button
          v-else
          class="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          @click="closeDialog">
          关闭
        </button>
      </div>
    </div>
  </Popup>
</template>

<style scoped>
/* Prose 样式（用于渲染 HTML 内容） */
.prose {
  @apply text-gray-900 dark:text-gray-100;
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4),
.prose :deep(h5),
.prose :deep(h6) {
  @apply font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2;
}

.prose :deep(h1) {
  @apply text-2xl;
}

.prose :deep(h2) {
  @apply text-xl;
}

.prose :deep(h3) {
  @apply text-lg;
}

.prose :deep(p) {
  @apply my-2 leading-relaxed;
}

.prose :deep(ul),
.prose :deep(ol) {
  @apply my-2 pl-6;
}

.prose :deep(ul) {
  @apply list-disc;
}

.prose :deep(ol) {
  @apply list-decimal;
}

.prose :deep(li) {
  @apply my-1;
}

.prose :deep(code) {
  @apply px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono;
}

.prose :deep(pre) {
  @apply p-4 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-x-auto my-3;
}

.prose :deep(pre code) {
  @apply p-0 bg-transparent;
}

.prose :deep(blockquote) {
  @apply border-l-4 border-blue-500 pl-4 italic my-3;
}

.prose :deep(table) {
  @apply w-full border-collapse my-3;
}

.prose :deep(th),
.prose :deep(td) {
  @apply border border-gray-200 dark:border-gray-700 px-3 py-2 text-left;
}

.prose :deep(th) {
  @apply bg-gray-100 dark:bg-gray-800 font-semibold;
}

.prose :deep(strong) {
  @apply font-semibold;
}

.prose :deep(em) {
  @apply italic;
}

.prose :deep(s) {
  @apply line-through;
}

.prose :deep(a) {
  @apply text-blue-500 hover:underline;
}

.prose :deep(img) {
  @apply max-w-full h-auto rounded-lg my-3;
}
</style>
