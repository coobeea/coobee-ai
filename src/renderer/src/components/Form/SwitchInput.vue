<template>
  <div class="flex items-center space-x-3">
    <label :for="switchId" class="relative inline-flex items-center cursor-pointer">
      <input
        :id="switchId"
        :checked="modelValue"
        type="checkbox"
        class="sr-only peer"
        :disabled="disabled"
        @change="handleChange" />
      <div
        :class="switchClasses"
        class="w-11 h-6 rounded-full peer transition-all duration-200 ease-in-out peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:duration-200 after:ease-in-out peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
    </label>

    <div v-if="label || $slots.default" class="flex-1">
      <label :for="switchId" class="block text-sm font-medium text-foreground cursor-pointer">
        <slot>{{ label }}</slot>
        <span v-if="required" class="text-red-500 ml-1">*</span>
      </label>
      <p v-if="description" class="text-sm text-muted-foreground mt-1">{{ description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

interface Props {
  modelValue?: boolean;
  label?: string;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'change', value: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  size: 'md'
});

const emit = defineEmits<Emits>();

const switchId = ref(`switch-${Math.random().toString(36).slice(2, 11)}`);

const switchClasses = computed(() => {
  const classes: string[] = [];

  // 基础样式 - 未选中状态
  classes.push('bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600');

  // 选中状态
  classes.push('peer-checked:bg-primary peer-checked:border-primary');

  // 尺寸
  switch (props.size) {
    case 'sm':
      classes.push('w-9 h-5');
      break;
    case 'lg':
      classes.push('w-14 h-8');
      break;
    default:
      classes.push('w-11 h-6');
  }

  return classes.join(' ');
});

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.checked;

  emit('update:modelValue', value);
  emit('change', value);
};
</script>
