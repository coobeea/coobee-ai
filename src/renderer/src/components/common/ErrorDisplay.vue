<template>
  <div
    v-if="error"
    class="error-display rounded-lg border p-4"
    :class="{
      'border-red-200 bg-red-50': level === 'error',
      'border-yellow-200 bg-yellow-50': level === 'warning',
      'border-blue-200 bg-blue-50': level === 'info'
    }">
    <!-- 标题行 -->
    <div class="mb-2 flex items-start justify-between">
      <div class="flex items-center gap-2">
        <span
          class="text-lg"
          :class="{
            'i-carbon-warning-alt text-red-500': level === 'error',
            'i-carbon-warning text-yellow-500': level === 'warning',
            'i-carbon-information text-blue-500': level === 'info'
          }"></span>
        <h4
          class="font-semibold"
          :class="{
            'text-red-700': level === 'error',
            'text-yellow-700': level === 'warning',
            'text-blue-700': level === 'info'
          }">
          {{ title }}
        </h4>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="showDetails"
          class="rounded p-1 hover:bg-gray-200"
          :title="expanded ? '收起详情' : '展开详情'"
          @click="expanded = !expanded">
          <span
            class="text-sm"
            :class="{
              'i-carbon-chevron-up': expanded,
              'i-carbon-chevron-down': !expanded
            }"></span>
        </button>
        <button class="rounded p-1 hover:bg-gray-200" title="复制错误信息" @click="copyErrorToClipboard">
          <span class="i-carbon-copy text-sm"></span>
        </button>
        <button v-if="dismissible" class="rounded p-1 hover:bg-gray-200" title="关闭" @click="$emit('dismiss')">
          <span class="i-carbon-close text-sm"></span>
        </button>
      </div>
    </div>

    <!-- 主要错误信息 -->
    <div
      class="mb-2 text-sm"
      :class="{
        'text-red-600': level === 'error',
        'text-yellow-600': level === 'warning',
        'text-blue-600': level === 'info'
      }">
      {{ message }}
    </div>

    <!-- 错误码 -->
    <div v-if="errorCode" class="mb-2 text-xs opacity-70">错误码: {{ errorCode }}</div>

    <!-- 详细信息（可折叠） -->
    <Transition name="expand">
      <div v-if="expanded && details" class="mt-3 overflow-auto rounded border border-gray-300 bg-white p-3">
        <pre class="whitespace-pre-wrap text-xs text-gray-700">{{ details }}</pre>
      </div>
    </Transition>

    <!-- 操作按钮 -->
    <div v-if="actions && actions.length > 0" class="mt-3 flex gap-2">
      <button
        v-for="action in actions"
        :key="action.label"
        class="rounded px-3 py-1.5 text-sm font-medium transition-colors"
        :class="{
          'bg-red-600 text-white hover:bg-red-700': action.type === 'primary' && level === 'error',
          'bg-yellow-600 text-white hover:bg-yellow-700': action.type === 'primary' && level === 'warning',
          'bg-blue-600 text-white hover:bg-blue-700': action.type === 'primary' && level === 'info',
          'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50': action.type === 'secondary'
        }"
        @click="action.handler">
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export interface ErrorAction {
  label: string;
  type: 'primary' | 'secondary';
  handler: () => void;
}

const props = withDefaults(
  defineProps<{
    error?: Error | { code?: string; message: string; details?: string } | null;
    level?: 'error' | 'warning' | 'info';
    title?: string;
    dismissible?: boolean;
    showDetails?: boolean;
    actions?: ErrorAction[];
  }>(),
  {
    level: 'error',
    title: '发生错误',
    dismissible: false,
    showDetails: true
  }
);

defineEmits<{
  dismiss: [];
}>();

const expanded = ref(false);

const message = computed(() => {
  if (!props.error) return '';
  if (typeof props.error === 'object' && 'message' in props.error) {
    return props.error.message;
  }
  return String(props.error);
});

const errorCode = computed(() => {
  if (!props.error || typeof props.error !== 'object') return null;
  return 'code' in props.error ? props.error.code : null;
});

const details = computed(() => {
  if (!props.error) return null;

  if (typeof props.error === 'object') {
    // 自定义错误对象
    if ('details' in props.error && props.error.details) {
      return props.error.details;
    }

    // 标准 Error 对象
    if (props.error instanceof Error && props.error.stack) {
      return props.error.stack;
    }
  }

  return null;
});

async function copyErrorToClipboard(): Promise<void> {
  const text = [
    `错误码: ${errorCode.value || 'N/A'}`,
    `信息: ${message.value}`,
    details.value ? `\n详情:\n${details.value}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
}
</script>

<style scoped>
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  max-height: 500px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
