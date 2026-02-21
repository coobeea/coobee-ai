<!--
  AIGenerate - 无渲染组件（Renderless Component）

  用途：为任意 UI 元素提供 AI 生成能力，不渲染任何 DOM 元素

  设计理念：
  - 通过 slot 接收用户自定义的 UI（如按钮、链接等）
  - 通过 slot props 暴露状态和方法
  - 完全不影响用户的布局和样式
  - 基于统一的 Agent 架构（quick-chat）

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
   * - 如果是字符串，直接作为提示词
   * - 如果是函数，调用 trigger 时可以传入上下文，函数接收上下文并返回提示词
   */
  prompt: PromptBuilder;

  /**
   * 是否在触发后自动解析 JSON 结果
   * @default false
   */
  autoParseJson?: boolean;

  /**
   * 是否禁用（优先级高于内部 isGenerating 状态）
   */
  disabled?: boolean;

  /**
   * 取消令牌（用于外部取消生成）
   */
  cancelToken?: { cancelled: boolean };
}

/**
 * 组件 Emits
 */
export interface AIGenerateEmits {
  /**
   * 生成开始
   */
  (e: 'start'): void;

  /**
   * 生成成功
   * @param result 生成结果（如果 autoParseJson 为 true，则为解析后的对象，否则为原始字符串）
   */
  (e: 'success', result: unknown): void;

  /**
   * 生成失败
   * @param error 错误信息
   */
  (e: 'error', error: string): void;

  /**
   * 生成取消
   */
  (e: 'cancel'): void;

  /**
   * 生成完成（无论成功或失败都会触发）
   */
  (e: 'complete'): void;

  /**
   * 输出内容（当前累积的完整文本）
   */
  (e: 'output', accumulated: string): void;
}

const props = withDefaults(defineProps<AIGenerateProps>(), {
  autoParseJson: false,
  disabled: false
});

const emit = defineEmits<AIGenerateEmits>();

// ==================== 状态管理 ====================

/**
 * 是否正在生成
 */
const isGenerating = ref(false);

/**
 * 生成结果
 */
const result = ref<unknown>(null);

/**
 * 错误信息
 */
const error = ref<string | null>(null);

/**
 * 累积的文本内容
 */
const accumulatedContent = ref('');

/**
 * 生成状态：'idle' | 'generating' | 'success' | 'error' | 'cancelled'
 */
const generateStatus = ref<'idle' | 'generating' | 'success' | 'error' | 'cancelled'>('idle');

// ==================== 核心方法 ====================

/**
 * 构建提示词（支持异步）
 */
const buildPrompt = async (context?: unknown): Promise<string> => {
  if (typeof props.prompt === 'function') {
    const result = props.prompt(context);
    // 支持同步和异步函数
    return await Promise.resolve(result);
  }
  return props.prompt;
};

/**
 * 解析 JSON 结果
 */
const parseJsonResult = (text: string): unknown => {
  try {
    // 1. 尝试提取 JSON 代码块（markdown 格式）
    const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }

    // 2. 尝试提取普通代码块
    const codeBlockMatch = text.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      // 检查是否是 JSON
      if (content.startsWith('{') || content.startsWith('[')) {
        return JSON.parse(content);
      }
    }

    // 3. 尝试查找第一个 JSON 对象或数组
    const jsonObjectMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonObjectMatch) {
      return JSON.parse(jsonObjectMatch[1]);
    }

    // 4. 尝试直接解析整个文本
    const trimmedText = text.trim();
    if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
      return JSON.parse(trimmedText);
    }

    // 5. 如果都失败，返回原始文本
    console.warn('[AIGenerate] 未找到有效的 JSON 内容，返回原始文本');
    return text;
  } catch (err) {
    console.warn('[AIGenerate] JSON 解析失败，返回原始文本:', err);
    // 最终返回原始文本
    return text;
  }
};

/**
 * 触发 AI 生成
 * @param context 可选的上下文参数，用于构建提示词
 */
const trigger = async (context?: unknown): Promise<void> => {
  // 检查是否被禁用
  if (props.disabled || isGenerating.value) {
    return;
  }

  // 重置状态
  isGenerating.value = true;
  error.value = null;
  result.value = null;
  accumulatedContent.value = '';
  generateStatus.value = 'generating';

  emit('start');

  try {
    // 构建提示词（支持异步）
    const prompt = await buildPrompt(context);
    if (!prompt || !prompt.trim()) {
      throw new Error('提示词不能为空');
    }

    // 调用 quick-chat
    const output = await quickChat(props.agent, prompt);

    // 检查是否被取消
    if (props.cancelToken?.cancelled) {
      generateStatus.value = 'cancelled';
      emit('cancel');
      return;
    }

    // 处理最终结果
    if (!output || !output.trim()) {
      throw new Error('AI 返回内容为空');
    }

    accumulatedContent.value = output;
    emit('output', output);

    // 解析结果
    const parsedResult = props.autoParseJson ? parseJsonResult(output) : output;
    result.value = parsedResult;
    generateStatus.value = 'success';

    emit('success', parsedResult);
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
 * 重置状态
 */
const reset = (): void => {
  isGenerating.value = false;
  result.value = null;
  error.value = null;
  accumulatedContent.value = '';
  generateStatus.value = 'idle';
};

// ==================== 生命周期 ====================

// 监听外部取消令牌
watch(
  () => props.cancelToken?.cancelled,
  (cancelled) => {
    if (cancelled && isGenerating.value) {
      cancel();
    }
  }
);

// 组件卸载时取消正在进行的生成
onUnmounted(() => {
  cancel();
});

// ==================== Slot Props 暴露 ====================

/**
 * 暴露给 slot 的属性和方法
 */
defineExpose({
  isGenerating,
  result,
  error,
  accumulatedContent,
  generateStatus,
  trigger,
  cancel,
  reset
});
</script>

<template>
  <!--
    无渲染组件：不渲染任何 DOM 元素，只通过 slot 提供能力

    Slot Props:
    - isGenerating: boolean - 是否正在生成
    - result: any - 生成结果
    - error: string | null - 错误信息
    - accumulatedContent: string - 累积的文本内容
    - generateStatus: 'idle' | 'generating' | 'success' | 'error' | 'cancelled' - 生成状态
    - trigger: (context?: any) => Promise<void> - 触发生成的方法
    - cancel: () => void - 取消生成的方法
    - reset: () => void - 重置状态的方法
  -->
  <slot
    :is-generating="isGenerating"
    :result="result"
    :error="error"
    :accumulated-content="accumulatedContent"
    :generate-status="generateStatus"
    :trigger="trigger"
    :cancel="cancel"
    :reset="reset" />
</template>
