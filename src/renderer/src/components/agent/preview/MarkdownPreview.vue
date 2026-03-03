<template>
  <div class="markdown-preview h-full w-full overflow-auto bg-white p-6">
    <div v-if="loading" class="text-gray-500">加载 Markdown 中...</div>
    <div v-else-if="error" class="text-red-500">{{ error }}</div>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else class="prose prose-sm max-w-none dark:prose-invert" v-html="renderedMarkdown" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const markdownContent = ref('');

marked.setOptions({
  breaks: true,
  gfm: true
});

// 自定义代码高亮渲染器
const renderer = new marked.Renderer();
// @ts-ignore - marked types may not match current version
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const validLanguage = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language: validLanguage }).value;
  return `<pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>`;
};

marked.use({ renderer });

const renderedMarkdown = computed(() => {
  if (!markdownContent.value) return '';

  try {
    return marked.parse(markdownContent.value);
  } catch (_err) {
    // 错误处理在 loadMarkdown 中统一处理
    return '';
  }
});

async function loadMarkdown(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    if (props.content !== undefined) {
      markdownContent.value = props.content;
    } else {
      const response = await fetch(`file://${props.filePath}`);
      markdownContent.value = await response.text();
    }
    loading.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载 Markdown 失败';
    loading.value = false;
  }
}

onMounted(() => {
  loadMarkdown();
});

watch(
  () => [props.filePath, props.content],
  () => {
    loadMarkdown();
  }
);
</script>
