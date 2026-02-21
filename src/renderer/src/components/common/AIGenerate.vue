<!--
  AIGenerate - AI 生成组件

  用途：为任意 UI 元素提供 AI 生成能力，内置弹出框显示生成过程和结果

  设计理念：
  - 通过 slot 接收用户自定义的触发 UI（如按钮、链接等）
  - 通过 slot props 暴露状态和方法
  - 内置弹出框显示生成过程和结果
  - 基于统一的 Agent 架构（quick-chat）

  使用示例：
  ```vue
  <AIGenerate
    v-slot="{ isGenerating, trigger }"
    agent="task-analyzer"
    :prompt="buildPrompt"
    @success="handleSuccess">
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
import Modal from './Modal.vue';

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
   * @default false
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
  autoParseJson: false,
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

    return text;
  } catch {
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
 * 判断是否为 HTML 内容
 */
const isHtmlContent = (text: string): boolean => {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /<[^>]+>/g.test(trimmed) && /^<[^>]+>/i.test(trimmed);
};

/**
 * 格式化值
 */
const formatValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
};

/**
 * 获取值类型
 */
const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
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
  generateStatus,
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
  <!-- Slot: 触发器 -->
  <slot
    :is-generating="isGenerating"
    :result="result"
    :error="error"
    :accumulated-content="accumulatedContent"
    :generate-status="generateStatus"
    :trigger="trigger"
    :cancel="cancel"
    :reset="reset" />

  <!-- 内置弹出框 -->
  <Modal
    v-model:visible="dialogVisible"
    :title="dialogTitle"
    width="800px"
    :closable="!isGenerating"
    :mask-closable="false">
    <!-- 内容区域 -->
    <div class="ai-generate-content">
      <!-- 生成中 -->
      <div v-if="generateStatus === 'generating'" class="status-section">
        <div class="status-icon">
          <span class="i-mdi-loading w-12 h-12 text-blue-500 animate-spin" />
        </div>
        <p class="status-text">AI 正在生成中...</p>
        <p class="status-hint">请稍候，这可能需要几秒钟</p>
      </div>

      <!-- 生成成功 -->
      <div v-else-if="generateStatus === 'success' && result" class="result-section">
        <!-- JSON 数据展示（数组） -->
        <div v-if="getValueType(result) === 'array'" class="space-y-3">
          <div v-for="(item, index) in result as any[]" :key="index" class="result-card">
            <div class="result-card-header">
              <span class="result-card-index">第 {{ index + 1 }} 项</span>
            </div>
            <div class="space-y-2">
              <div v-for="(value, key) in item" :key="String(key)" class="result-field">
                <span class="result-field-label">{{ key }}</span>
                <span class="result-field-value">{{ formatValue(value) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- JSON 数据展示（对象） -->
        <div v-else-if="getValueType(result) === 'object'" class="space-y-2">
          <div v-for="(value, key) in result as Record<string, any>" :key="String(key)" class="result-card">
            <div class="result-field">
              <span class="result-field-label">{{ key }}</span>
              <span class="result-field-value">{{ formatValue(value) }}</span>
            </div>
          </div>
        </div>

        <!-- 纯文本/HTML 展示 -->
        <div v-else>
          <!-- HTML 内容渲染 -->
          <div v-if="isHtmlContent(String(result))" class="space-y-3">
            <div class="html-preview">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div v-html="String(result)"></div>
            </div>
            <details class="html-source">
              <summary class="html-source-toggle">
                <span class="i-mdi-code-tags w-4 h-4" />
                <span>查看源代码</span>
                <span class="i-mdi-chevron-down w-4 h-4 transition-transform" />
              </summary>
              <pre class="html-source-code">{{ result }}</pre>
            </details>
          </div>

          <!-- 纯文本 -->
          <div v-else class="text-result">
            {{ result }}
          </div>

          <!-- 复制按钮 -->
          <div class="result-actions">
            <button class="copy-button" @click="copyResult">
              <span class="i-mdi-content-copy w-4 h-4" />
              <span>复制</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 生成失败 -->
      <div v-else-if="generateStatus === 'error'" class="status-section">
        <div class="status-icon">
          <span class="i-mdi-alert-circle w-12 h-12 text-red-500" />
        </div>
        <p class="status-text text-red-600">生成失败</p>
        <p class="status-hint text-red-500">{{ error }}</p>
      </div>

      <!-- 已取消 -->
      <div v-else-if="generateStatus === 'cancelled'" class="status-section">
        <div class="status-icon">
          <span class="i-mdi-cancel w-12 h-12 text-yellow-500" />
        </div>
        <p class="status-text text-yellow-600">生成已取消</p>
        <p class="status-hint">AI 生成任务已被手动取消</p>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <template #footer>
      <!-- 生成中 - 显示取消按钮 -->
      <button v-if="generateStatus === 'generating'" class="btn btn-danger" @click="cancel">
        <span class="i-mdi-cancel w-4 h-4" />
        取消生成
      </button>

      <!-- 生成成功 - 需要确认模式 -->
      <template v-else-if="generateStatus === 'success' && requireConfirm">
        <button class="btn btn-secondary" @click="closeDialog"> 取消 </button>
        <button class="btn btn-primary" :disabled="isConfirmed" @click="confirmResult">
          <span class="i-mdi-check w-4 h-4" />
          {{ isConfirmed ? '已应用' : confirmText }}
        </button>
      </template>

      <!-- 生成完成 - 普通模式 -->
      <button v-else class="btn btn-secondary" @click="closeDialog"> 关闭 </button>
    </template>
  </Modal>
</template>

<style scoped>
.ai-generate-content {
  min-height: 200px;
}

/* 状态区域 */
.status-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.status-icon {
  margin-bottom: 16px;
}

.status-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.status-hint {
  font-size: 14px;
  color: var(--color-text-secondary);
}

/* 结果区域 */
.result-section {
  max-height: 60vh;
  overflow-y: auto;
}

.result-card {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-muted);
  transition: background 0.2s;
}

.result-card:hover {
  background: var(--color-background-soft);
}

.result-card-header {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.result-card-index {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

.result-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.result-field-value {
  font-size: 14px;
  color: var(--color-text);
  word-break: break-word;
}

/* HTML 展示 */
.html-preview {
  padding: 16px;
  background: var(--color-background);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.html-source {
  margin-top: 12px;
}

.html-source-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--color-background-muted);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text);
  transition: background 0.2s;
}

.html-source-toggle:hover {
  background: var(--color-background-soft);
}

.html-source[open] .html-source-toggle span:last-child {
  transform: rotate(180deg);
}

.html-source-code {
  margin-top: 8px;
  padding: 12px;
  background: var(--color-background-muted);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 文本结果 */
.text-result {
  padding: 16px;
  background: var(--color-background-muted);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.result-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.copy-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-button:hover {
  background: var(--color-primary-light);
}

/* 按钮样式 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  color: white;
  background: var(--color-primary);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-secondary {
  color: var(--color-text);
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-background-muted);
}

.btn-danger {
  color: white;
  background: var(--color-error);
}

.btn-danger:hover {
  background: var(--color-error-dark);
}
</style>
