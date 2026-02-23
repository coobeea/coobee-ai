<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ContentBlock } from '@/composables/useStreamHandler';

const props = defineProps<{
  block: ContentBlock & { type: 'thinking' };
}>();

const MAX_LINES = 15; // 最多显示行数
const collapsed = ref(false);

// 计算文本行数（简单按换行符计算）
const lineCount = computed(() => {
  return props.block.text?.split('\n').length ?? 0;
});

// 是否需要折叠功能
const needsCollapse = computed(() => lineCount.value > MAX_LINES);

// 初始化时，如果超过最大行数则自动折叠
if (needsCollapse.value) {
  collapsed.value = true;
}

// 切换折叠状态
const toggleCollapse = (): void => {
  collapsed.value = !collapsed.value;
};
</script>

<template>
  <div class="msg-thinking">
    <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
    <div class="flex-1">
      <div class="msg-thinking-text" :class="{ collapsed: collapsed }">
        {{ block.text }}
      </div>
      <button v-if="needsCollapse" class="collapse-toggle" @click="toggleCollapse">
        <span v-if="collapsed" class="i-carbon-chevron-down inline-block h-3 w-3" />
        <span v-else class="i-carbon-chevron-up inline-block h-3 w-3" />
        <span class="ml-1">{{ collapsed ? '展开' : '收起' }}</span>
      </button>
    </div>
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  transition: max-height 0.3s ease;
}

.msg-thinking-text.collapsed {
  max-height: calc(1.5em * 15); /* 15 行高度 */
  overflow: hidden;
  position: relative;
}

.msg-thinking-text.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3em;
  background: linear-gradient(to bottom, transparent, hsl(var(--muted) / 0.3));
  pointer-events: none;
}

.collapse-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.5);
  border: 1px solid hsl(var(--border));
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.collapse-toggle:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.8);
  border-color: hsl(var(--muted-foreground) / 0.5);
}
</style>
