<script setup lang="ts">
import type { QueuedMessage } from '@/stores/chat';

defineProps<{
  queue: QueuedMessage[];
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

function truncateText(text: string, maxLines: number = 3): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '...';
}
</script>

<template>
  <div v-if="queue.length > 0" class="mb-3 rounded-lg border border-amber-500/30 bg-amber-50/50 p-3">
    <div class="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700">
      <span class="i-carbon-queued inline-block h-4 w-4"></span>
      <span>{{ queue.length }} Queued</span>
    </div>

    <div class="space-y-2">
      <div
        v-for="item in queue"
        :key="item.id"
        class="flex items-start gap-2 rounded-md bg-white/80 p-2 text-sm shadow-sm">
        <div class="flex-1 overflow-hidden">
          <div class="whitespace-pre-wrap break-words text-gray-700">
            {{ truncateText(item.text) }}
          </div>
          <div v-if="item.files && item.files.length > 0" class="mt-1 text-xs text-gray-500">
            <span class="i-carbon-document inline-block h-3 w-3"></span>
            {{ item.files.length }} 个文件
          </div>
        </div>
        <button
          type="button"
          class="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
          title="删除"
          @click="emit('remove', item.id)">
          <span class="i-carbon-close inline-block h-4 w-4"></span>
        </button>
      </div>
    </div>
  </div>
</template>
