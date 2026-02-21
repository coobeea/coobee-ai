<script setup lang="ts">
import { computed } from 'vue';
import type { ContentBlock } from '@/composables/useStreamHandler';

const props = defineProps<{
  block: ContentBlock & { type: 'tool' };
}>();

const statusIconClass = computed(() => {
  const status = props.block.tool.status;
  if (status === 'calling') return 'i-carbon-renew animate-spin';
  if (status === 'approval-pending') return 'i-carbon-locked text-blue-600';
  if (status === 'done') return 'i-carbon-checkmark';
  return 'i-carbon-warning-alt';
});

const statusText = computed(() => {
  const status = props.block.tool.status;
  if (status === 'approval-pending') return `${props.block.tool.name} (等待审批)`;
  if (status === 'calling') return `调用 ${props.block.tool.name}...`;
  if (status === 'done') return `${props.block.tool.name} 完成`;
  return `${props.block.tool.name} 失败`;
});
</script>

<template>
  <div class="msg-tool">
    <span class="inline-block h-3 w-3 shrink-0" :class="statusIconClass" />
    <span>{{ statusText }}</span>
  </div>
</template>

<style scoped>
.msg-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.5);
  padding: 4px 8px;
  border-radius: 4px;
  align-self: flex-start;
}
</style>
