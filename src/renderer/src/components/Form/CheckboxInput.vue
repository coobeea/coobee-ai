<template>
  <div class="flex items-start space-x-3">
    <div class="flex items-center h-5">
      <div class="relative">
        <input
          :id="checkboxId"
          :checked="modelValue"
          type="checkbox"
          :disabled="disabled"
          :required="required"
          class="sr-only peer"
          @change="handleChange" />
        <div
          :class="checkboxClasses"
          class="w-4 h-4 rounded border transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          <i
            class="i-mdi-check w-3 h-3 text-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity"></i>
        </div>
      </div>
    </div>

    <div v-if="label || $slots.default" class="flex-1">
      <label :for="checkboxId" class="block text-sm font-medium text-foreground cursor-pointer">
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
  error?: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'change', value: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false
});

const emit = defineEmits<Emits>();

const checkboxId = ref(`checkbox-${Math.random().toString(36).slice(2, 11)}`);

const checkboxClasses = computed(() => {
  const classes: string[] = [];

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
  const value = target.checked;

  emit('update:modelValue', value);
  emit('change', value);
};
</script>
