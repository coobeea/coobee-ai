<template>
  <div class="html-preview h-full w-full">
    <iframe
      v-if="iframeSrc"
      :src="iframeSrc"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      class="h-full w-full border-0" />
    <div v-else class="flex h-full w-full items-center justify-center bg-gray-100">
      <div class="text-gray-500">加载中...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const blobUrl = ref<string>('');

const isHttpUrl = computed(() => /^https?:\/\//i.test(props.filePath));

// ✅ 将副作用从 computed 移到 watch
watch(
  () => props.content,
  (newContent) => {
    if (newContent && !isHttpUrl.value) {
      if (blobUrl.value) {
        URL.revokeObjectURL(blobUrl.value);
      }
      const blob = new Blob([newContent], { type: 'text/html' });
      blobUrl.value = URL.createObjectURL(blob);
    }
  },
  { immediate: true }
);

const iframeSrc = computed(() => {
  if (isHttpUrl.value) {
    return props.filePath;
  }
  return blobUrl.value || '';
});

onBeforeUnmount(() => {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value);
  }
});
</script>
