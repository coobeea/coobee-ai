<script setup lang="ts">
import type { ContentBlock } from '@/composables/useStreamHandler';

defineProps<{
  block: ContentBlock & { type: 'text' };
}>();
</script>

<template>
  <div class="msg-text" v-text="block.text" />
</template>

<style scoped>
.msg-text {
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.9);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
