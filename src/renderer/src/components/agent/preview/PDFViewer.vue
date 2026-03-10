<template>
  <div class="pdf-viewer h-full w-full overflow-auto bg-gray-100 p-4">
    <div v-if="loading" class="flex h-full items-center justify-center">
      <div class="text-gray-500">加载 PDF 中...</div>
    </div>
    <div v-else-if="error" class="flex h-full items-center justify-center">
      <div class="text-red-500">{{ error }}</div>
    </div>
    <div v-else class="mx-auto max-w-4xl">
      <div v-for="pageNum in numPages" :key="pageNum" class="mb-4">
        <canvas
          :ref="(el) => setCanvasRef(pageNum, el as HTMLCanvasElement)"
          class="mx-auto border border-gray-300 bg-white shadow-sm" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const numPages = ref(0);
const canvasRefs = ref<Map<number, HTMLCanvasElement>>(new Map());

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

function setCanvasRef(pageNum: number, el: HTMLCanvasElement): void {
  if (el) {
    canvasRefs.value.set(pageNum, el);
  }
}

async function loadPDF(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const loadingTask = pdfjsLib.getDocument(props.filePath);
    const pdf = await loadingTask.promise;

    numPages.value = pdf.numPages;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const canvas = canvasRefs.value.get(pageNum);

      if (canvas) {
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        if (context) {
          // @ts-ignore - pdfjs-dist types may not match current version
          await page.render({
            canvasContext: context,
            viewport
          }).promise;
        }
      }
    }

    loading.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载 PDF 失败';
    loading.value = false;
  }
}

onMounted(() => {
  loadPDF();
});

watch(
  () => props.filePath,
  () => {
    canvasRefs.value.clear();
    loadPDF();
  }
);
</script>
