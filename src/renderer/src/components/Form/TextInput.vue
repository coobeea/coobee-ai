<template>
  <div class="space-y-2">
    <label v-if="label" :for="inputId" class="block text-sm font-medium text-foreground">
      {{ label }}
      <span v-if="required" class="text-red-500 ml-1">*</span>
    </label>

    <div class="relative">
      <input
        v-if="type !== 'textarea'"
        :id="inputId"
        :value="modelValue"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :step="step"
        :min="min"
        :max="max"
        :class="inputClasses"
        class="input w-full px-3 py-2 border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
        @input="handleInput"
        @blur="handleBlur"
        @focus="handleFocus" />

      <textarea
        v-else
        :id="inputId"
        ref="textareaRef"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :rows="rows || 3"
        :style="textareaStyle"
        :class="[inputClasses, isMaxHeight ? 'overflow-y-auto' : 'overflow-hidden']"
        class="input w-full px-3 py-2 border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed resize-none"
        @input="handleInput"
        @blur="handleBlur"
        @focus="handleFocus" />

      <!-- 错误图标 -->
      <div v-if="error" class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
        <i class="i-mdi-alert-circle w-5 h-5 text-red-500" />
      </div>
    </div>

    <!-- 错误信息 -->
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <!-- 帮助文本 -->
    <p v-if="help && !error" class="text-sm text-muted-foreground">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

interface Props {
  modelValue?: string | number;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'textarea';
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  error?: string;
  help?: string;
  size?: 'sm' | 'md' | 'lg';
  step?: string | number;
  min?: string | number;
  max?: string | number;
  rows?: number;
  maxRows?: number;
}

interface Emits {
  (e: 'update:modelValue', value: string | number): void;
  (e: 'blur', event: FocusEvent): void;
  (e: 'focus', event: FocusEvent): void;
  (e: 'input', event: Event): void;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  size: 'md'
});

const emit = defineEmits<Emits>();

const inputId = ref(`input-${Math.random().toString(36).slice(2, 11)}`);
const textareaRef = ref<HTMLTextAreaElement>();
const isMaxHeight = ref(false); // 是否已达到最大高度

// 计算 textarea 的动态样式
const textareaStyle = computed(() => {
  if (props.type !== 'textarea') return {};

  return {
    minHeight: `${(props.rows || 3) * 1.5}em`,
    maxHeight: props.maxRows ? `${props.maxRows * 1.5}em` : 'none'
  };
});

// 自动调整 textarea 高度
const autoResize = () => {
  if (!textareaRef.value || props.type !== 'textarea') return;

  const textarea = textareaRef.value;

  // 重置高度以获取正确的 scrollHeight
  textarea.style.height = 'auto';

  // 计算新高度
  const minHeight = (props.rows || 3) * 24; // 假设每行约 24px
  const maxHeight = props.maxRows ? props.maxRows * 24 : Infinity;
  const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

  // 检查是否达到最大高度
  isMaxHeight.value = props.maxRows ? textarea.scrollHeight > maxHeight : false;

  // 设置新高度
  textarea.style.height = `${newHeight}px`;
};

const inputClasses = computed(() => {
  const classes: string[] = [];

  // 基础样式
  classes.push('bg-background border-border text-foreground');

  // 尺寸
  switch (props.size) {
    case 'sm':
      classes.push('px-2 py-1 text-sm');
      break;
    case 'lg':
      classes.push('px-4 py-3 text-lg');
      break;
    default:
      classes.push('px-3 py-2');
  }

  // 错误状态
  if (props.error) {
    classes.push('border-red-500 focus:border-red-500 focus:ring-red-500/20');
  } else {
    classes.push('border-gray-300 dark:border-gray-600');
  }

  return classes.join(' ');
});

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value: string | number = target.value;

  if (props.type === 'number') {
    value = target.valueAsNumber || 0;
  }

  emit('update:modelValue', value);
  emit('input', event);

  // 如果是 textarea，自动调整高度
  if (props.type === 'textarea') {
    nextTick(() => {
      autoResize();
    });
  }
};

const handleBlur = (event: FocusEvent) => {
  emit('blur', event);
};

const handleFocus = (event: FocusEvent) => {
  emit('focus', event);
};

// 组件挂载后初始化 textarea 高度
onMounted(() => {
  if (props.type === 'textarea') {
    nextTick(() => {
      autoResize();
    });
  }
});
</script>
