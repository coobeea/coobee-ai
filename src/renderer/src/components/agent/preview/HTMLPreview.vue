<template>
  <div class="html-preview h-full w-full">
    <iframe
      v-if="!error"
      :src="htmlUrl"
      :sandbox="
        isHttpUrl ? 'allow-scripts allow-same-origin allow-forms allow-popups' : 'allow-scripts allow-same-origin'
      "
      class="h-full w-full border-0"
      @error="handleError" />
    <div v-else class="flex h-full w-full items-center justify-center bg-gray-100">
      <div class="text-red-500">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const error = ref<string | null>(null);

const isHttpUrl = computed(() => /^https?:\/\//i.test(props.filePath));

const htmlUrl = computed(() => {
  if (props.content) {
    const blob = new Blob([props.content], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }
  if (/^https?:\/\//i.test(props.filePath)) {
    return props.filePath;
  }
  return `file://${props.filePath}`;
});

function handleError(): void {
  error.value = 'HTML 预览失败';
}
</script>
