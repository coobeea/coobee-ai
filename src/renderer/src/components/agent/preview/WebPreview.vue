<template>
  <div class="web-preview flex h-full w-full flex-col">
    <!-- 地址栏 -->
    <div class="flex h-8 shrink-0 items-center gap-2 border-b border-gray-200/60 bg-gray-50/80 px-2">
      <button
        class="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200/60"
        title="刷新"
        @click="reload">
        <span class="i-carbon-renew inline-block h-3 w-3 text-gray-500"></span>
      </button>
      <div
        class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-gray-600 ring-1 ring-gray-200/80">
        <span class="i-carbon-earth inline-block h-3 w-3 shrink-0 text-gray-400"></span>
        <input
          v-model="currentUrl"
          class="min-w-0 flex-1 bg-transparent outline-none"
          spellcheck="false"
          @keydown.enter="navigate" />
      </div>
      <button
        class="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200/60"
        title="在浏览器中打开"
        @click="openExternal">
        <span class="i-carbon-launch inline-block h-3 w-3 text-gray-500"></span>
      </button>
    </div>

    <!-- iframe 内容 -->
    <div class="relative min-h-0 flex-1">
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin text-gray-300"></span>
      </div>
      <iframe
        v-if="!error"
        ref="iframeEl"
        :src="displayUrl"
        class="h-full w-full border-0"
        :sandbox="sandboxAttr"
        @load="onLoad"
        @error="onError" />
      <div v-if="error" class="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-50 p-8">
        <span class="i-carbon-warning-alt inline-block h-8 w-8 text-amber-400"></span>
        <p class="text-sm text-gray-600">{{ error }}</p>
        <button
          class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
          @click="retry">
          重试
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = defineProps<{
  filePath: string;
  content?: string;
}>();

const iframeEl = ref<HTMLIFrameElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const currentUrl = ref(props.filePath);

const isLocalhost = computed(() => {
  try {
    const url = new URL(currentUrl.value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
});

const sandboxAttr = computed(() => {
  if (isLocalhost.value) {
    return 'allow-scripts allow-same-origin allow-forms allow-popups';
  }
  return 'allow-scripts allow-same-origin';
});

const displayUrl = ref(props.filePath);

watch(
  () => props.filePath,
  (newPath) => {
    currentUrl.value = newPath;
    displayUrl.value = newPath;
    loading.value = true;
    error.value = null;
  }
);

function navigate(): void {
  let url = currentUrl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
    currentUrl.value = url;
  }
  displayUrl.value = url;
  loading.value = true;
  error.value = null;
}

function reload(): void {
  if (iframeEl.value) {
    loading.value = true;
    error.value = null;
    iframeEl.value.src = displayUrl.value;
  }
}

function retry(): void {
  error.value = null;
  loading.value = true;
  displayUrl.value = currentUrl.value;
}

function onLoad(): void {
  loading.value = false;
}

function onError(): void {
  loading.value = false;
  error.value = '无法加载页面，请检查 URL 是否正确或服务是否已启动';
}

function openExternal(): void {
  window.open(currentUrl.value, '_blank');
}
</script>
