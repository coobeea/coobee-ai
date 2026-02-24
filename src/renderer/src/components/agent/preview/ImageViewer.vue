<template>
  <div class="image-viewer flex h-full w-full items-center justify-center overflow-auto bg-gray-100 p-4">
    <div v-if="loading" class="text-gray-500">加载图片中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <div v-else class="relative" @wheel.prevent="handleZoom">
      <img
        :src="imageUrl"
        :alt="filePath"
        :style="{ transform: `scale(${zoom})` }"
        class="max-w-none transition-transform"
        @load="handleLoad"
        @error="handleError" />
      <div class="absolute bottom-4 right-4 flex gap-2 rounded bg-black/50 p-2">
        <button class="rounded bg-white px-2 py-1 text-sm hover:bg-gray-200" @click="zoomIn"> + </button>
        <button class="rounded bg-white px-2 py-1 text-sm hover:bg-gray-200" @click="zoomOut"> - </button>
        <button class="rounded bg-white px-2 py-1 text-sm hover:bg-gray-200" @click="resetZoom"> 100% </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const zoom = ref(1);

const imageUrl = computed(() => {
  if (props.content) {
    return `data:image/png;base64,${props.content}`;
  }
  return `file://${props.filePath}`;
});

function handleLoad(): void {
  loading.value = false;
}

function handleError(): void {
  loading.value = false;
  error.value = '加载图片失败';
}

function handleZoom(event: WheelEvent): void {
  const delta = event.deltaY > 0 ? -0.1 : 0.1;
  zoom.value = Math.max(0.1, Math.min(5, zoom.value + delta));
}

function zoomIn(): void {
  zoom.value = Math.min(5, zoom.value + 0.2);
}

function zoomOut(): void {
  zoom.value = Math.max(0.1, zoom.value - 0.2);
}

function resetZoom(): void {
  zoom.value = 1;
}
</script>
