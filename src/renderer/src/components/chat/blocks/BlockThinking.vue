<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ContentBlock } from '@/composables/useStreamHandler';

const props = defineProps<{
  block: ContentBlock & { type: 'thinking' };
}>();

const MAX_LINES = 8;
const collapsed = ref(false);
const userExpanded = ref(false);

const lineCount = computed(() => {
  return props.block.text?.split('\n').length ?? 0;
});

const needsCollapse = computed(() => lineCount.value > MAX_LINES);

watch(
  () => lineCount.value,
  (count) => {
    if (count > MAX_LINES && !userExpanded.value) {
      collapsed.value = true;
    }
  }
);

function toggleCollapse(): void {
  if (collapsed.value) {
    collapsed.value = false;
    userExpanded.value = true;
  } else {
    collapsed.value = true;
    userExpanded.value = false;
  }
}
</script>

<template>
  <div class="msg-thinking">
    <div class="thinking-header" @click="needsCollapse ? toggleCollapse() : undefined">
      <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
      <span class="thinking-label">思考</span>
      <span v-if="needsCollapse" class="thinking-line-count">{{ lineCount }} 行</span>
      <button v-if="needsCollapse" class="collapse-btn">
        <span
          class="inline-block h-3 w-3 transition-transform duration-200"
          :class="collapsed ? 'i-carbon-chevron-right' : 'i-carbon-chevron-down'" />
      </button>
    </div>
    <div v-show="!collapsed" class="thinking-body">
      <div class="msg-thinking-text">
        {{ block.text }}
      </div>
    </div>
    <div v-if="collapsed && needsCollapse" class="collapsed-preview" @click="toggleCollapse">
      {{ block.text?.split('\n').slice(0, 2).join(' ').substring(0, 80) }}...
    </div>
  </div>
</template>

<style scoped>
.msg-thinking {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.3);
  border-radius: 6px;
  border-left: 2px solid hsl(var(--muted-foreground) / 0.3);
  overflow: hidden;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  user-select: none;
}

.thinking-header:hover {
  background: hsl(var(--muted) / 0.5);
}

.thinking-label {
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.thinking-line-count {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-left: auto;
}

.collapse-btn {
  display: flex;
  align-items: center;
  padding: 0;
  background: none;
  border: none;
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
}

.thinking-body {
  padding: 0 10px 6px;
}

.msg-thinking-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
  line-height: 1.5;
}

.collapsed-preview {
  padding: 0 10px 5px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-style: italic;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapsed-preview:hover {
  color: hsl(var(--muted-foreground) / 0.8);
}
</style>
