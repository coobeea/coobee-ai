<script setup lang="ts">
import type { ContentBlock } from '@/composables/useStreamHandler';
import NodeRenderer from 'markstream-vue';

defineProps<{
  block: ContentBlock & { type: 'text' };
}>();
</script>

<template>
  <div class="prose prose-zinc prose-sm dark:prose-invert w-full max-w-none">
    <NodeRenderer :content="block.text" />
  </div>
</template>

<style scoped>
/* 自定义 prose 样式微调 */
.prose :deep(p) {
  margin: 0.5rem 0;
}

.prose :deep(p:first-child) {
  margin-top: 0;
}

.prose :deep(p:last-child) {
  margin-bottom: 0;
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4),
.prose :deep(h5),
.prose :deep(h6) {
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
}

.prose :deep(ul),
.prose :deep(ol) {
  margin: 0.5rem 0;
}

.prose :deep(li p) {
  margin: 0;
}

.prose :deep(pre) {
  margin: 0.5rem 0;
}

.prose :deep(hr) {
  margin: 1rem 0;
}
</style>
