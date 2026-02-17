<template>
  <div class="space-y-3">
    <div v-if="label" class="block text-sm font-medium text-foreground">
      {{ label }}
      <span v-if="required" class="text-red-500 ml-1">*</span>
    </div>

    <div :class="direction === 'horizontal' ? 'flex flex-wrap gap-6' : 'space-y-3'">
      <div v-for="option in options" :key="option.value" class="flex items-start space-x-3">
        <div class="flex items-center h-5">
          <!-- 自定义单选框实现 -->
          <div class="relative">
            <input
              :id="`${radioId}-${option.value}`"
              :value="option.value"
              :checked="modelValue === option.value"
              :name="radioId"
              type="radio"
              :disabled="disabled || option.disabled"
              :required="required"
              class="sr-only peer"
              @change="handleChange" />
            <div
              :class="radioClasses"
              class="w-4 h-4 rounded-full border transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <div
                class="w-2 h-2 rounded-full bg-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity"></div>
            </div>
          </div>
        </div>

        <div class="flex-1">
          <label :for="`${radioId}-${option.value}`" class="block text-sm font-medium text-foreground cursor-pointer">
            {{ option.label }}
          </label>
          <p v-if="option.description" class="text-sm text-muted-foreground mt-1">
            {{ option.description }}
          </p>
        </div>
      </div>
    </div>

    <!-- 错误信息 -->
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <!-- 帮助文本 -->
    <p v-if="help && !error" class="text-sm text-muted-foreground">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

interface RadioOption {
  label: string;
  value: string | number;
  description?: string;
  disabled?: boolean;
}

interface Props {
  modelValue?: string | number;
  options: RadioOption[];
  label?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  help?: string;
  direction?: 'vertical' | 'horizontal';
}

interface Emits {
  (e: 'update:modelValue', value: string | number): void;
  (e: 'change', value: string | number): void;
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'vertical'
});

const emit = defineEmits<Emits>();

const radioId = ref(`radio-${Math.random().toString(36).slice(2, 11)}`);

const radioClasses = computed(() => {
  const classes: string[] = [];

  // 基础样式
  classes.push('bg-input-background');

  if (props.error) {
    classes.push('border-red-500 peer-checked:bg-red-600 peer-checked:border-red-600');
  } else {
    classes.push('border-border peer-checked:bg-primary peer-checked:border-primary');
  }

  return classes.join(' ');
});

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value;

  // 尝试转换为数字（如果原始值是数字）
  const numericValue = Number(value);
  const finalValue = !isNaN(numericValue) && value === numericValue.toString() ? numericValue : value;

  emit('update:modelValue', finalValue);
  emit('change', finalValue);
};
</script>
