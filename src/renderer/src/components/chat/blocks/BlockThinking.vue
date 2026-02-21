<script setup lang="ts">
import type { ContentBlock } from '@/composables/useStreamHandler';

defineProps<{
  block: ContentBlock & { type: 'thinking' };
}>();
</script>

<template>
  <div class="msg-thinking">
    <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
    <span class="msg-thinking-text">{{ block.text }}</span>
  </div>
</template>

<style scoped>
.msg-thinking {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.3);
  padding: 6px 10px;
  border-radius: 6px;
  border-left: 2px solid hsl(var(--muted-foreground) / 0.3);
}

.msg-thinking-text {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
