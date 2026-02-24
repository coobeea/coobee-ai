<template>
  <div class="video-player flex h-full w-full items-center justify-center bg-black p-4">
    <video v-if="!error" controls class="max-h-full max-w-full" @error="handleError">
      <source :src="videoUrl" :type="mimeType" />
      您的浏览器不支持视频播放。
    </video>
    <div v-else class="text-red-500">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  filePath: string;
  mimeType?: string;
  content?: string;
}>();

const error = ref<string | null>(null);

const videoUrl = computed(() => {
  if (props.content) {
    return `data:${props.mimeType || 'video/mp4'};base64,${props.content}`;
  }
  return `file://${props.filePath}`;
});

function handleError(): void {
  error.value = '视频加载失败';
}
</script>
