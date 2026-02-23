<script setup lang="ts">
import type { QueuedMessage } from '@/stores/chat';

defineProps<{
  queue: QueuedMessage[];
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();
</script>

<template>
  <div v-if="queue.length > 0" class="mb-3 border-t border-gray-200/60 px-3 pt-2">
    <!-- 队列头部 -->
    <div class="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
      <span class="i-carbon-chevron-down inline-block h-3.5 w-3.5"></span>
      <span>{{ queue.length }} Queued</span>
    </div>

    <!-- 队列消息列表 -->
    <div class="space-y-2">
      <div v-for="item in queue" :key="item.id" class="group flex items-start gap-2 py-1">
        <!-- 消息内容 -->
        <div class="flex-1 overflow-hidden text-xs text-gray-600">
          <div class="line-clamp-3 whitespace-pre-wrap break-words">
            {{ item.text }}
          </div>
          <div v-if="item.files && item.files.length > 0" class="mt-1 flex items-center gap-1 text-gray-400">
            <span class="i-carbon-document inline-block h-3 w-3"></span>
            <span>{{ item.files.length }} 个文件</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <button
          type="button"
          class="flex-shrink-0 rounded p-0.5 opacity-0 transition-all hover:bg-gray-100 group-hover:opacity-100"
          title="删除"
          @click="emit('remove', item.id)">
          <span class="i-carbon-close inline-block h-3.5 w-3.5 text-gray-400 hover:text-red-500"></span>
        </button>
      </div>
    </div>
  </div>
</template>
