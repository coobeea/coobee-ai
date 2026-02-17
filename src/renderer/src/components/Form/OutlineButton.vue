<template>
  <BaseButton variant="outline" v-bind="$props" @click="$emit('click', $event)">
    <slot />
  </BaseButton>
</template>

<script setup lang="ts">
import BaseButton from './BaseButton.vue';
import type { OutlineButtonProps } from './types';

withDefaults(defineProps<OutlineButtonProps>(), {
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
  fullWidth: false,
  mode: 'text'
});

defineEmits<{
  click: [event: MouseEvent];
}>();
</script>
