<script setup lang="ts">
/**
 * MemorySettings - 记忆管理组件
 *
 * 展示 Agent 工作空间中的记忆文件（MEMORY.md + memory/*.md）
 * 通过 Gateway 监控 API 获取数据
 */

import { ref, onMounted } from 'vue';

interface MemoryFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
  scope: string;
}

const GATEWAY_BASE = 'http://localhost:42068/gateway';

const files = ref<MemoryFile[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedFile = ref<MemoryFile | null>(null);
const fileContent = ref<string>('');
const contentLoading = ref(false);

async function loadFiles(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`${GATEWAY_BASE}/monitoring/memory-files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    files.value = data.files || [];
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function selectFile(file: MemoryFile): Promise<void> {
  selectedFile.value = file;
  contentLoading.value = true;
  try {
    const res = await fetch(`${GATEWAY_BASE}/monitoring/memory-content?file=${encodeURIComponent(file.path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fileContent.value = data.content || '';
  } catch {
    fileContent.value = '(读取失败)';
  } finally {
    contentLoading.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function scopeLabel(scope: string): string {
  if (scope === 'global') return '全局';
  if (scope.startsWith('workspace:')) {
    const id = scope.slice(10);
    return id.length > 12 ? id.slice(0, 12) + '...' : id;
  }
  return scope;
}

onMounted(() => {
  loadFiles();
});
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧：记忆文件列表 -->
    <div class="flex w-72 flex-col border-r border-border bg-card">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold">记忆文件</h2>
          <p class="text-[10px] text-muted-foreground">{{ files.length }} 个文件</p>
        </div>
        <button
          class="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
          @click="loadFiles">
          <span class="i-carbon-renew inline-block h-3 w-3"></span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-2 inline-block h-5 w-5 animate-spin"></span>
          <p class="text-xs">加载中...</p>
        </div>

        <!-- 错误 -->
        <div v-else-if="error" class="p-4 text-xs text-red-500">
          {{ error }}
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="files.length === 0"
          class="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <span class="i-carbon-document-blank mb-2 inline-block h-8 w-8 opacity-40"></span>
          <p class="text-xs">暂无记忆文件</p>
          <p class="mt-1 text-[10px] text-muted-foreground/60">Agent 运行时会自动生成记忆</p>
        </div>

        <!-- 文件列表 -->
        <div v-else class="p-2">
          <div
            v-for="file in files"
            :key="file.path"
            :class="[
              'cursor-pointer rounded-lg border px-3 py-2 mb-1 transition-colors',
              selectedFile?.path === file.path ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted'
            ]"
            @click="selectFile(file)">
            <div class="flex items-center gap-2">
              <span class="i-carbon-document inline-block h-3.5 w-3.5 shrink-0 text-muted-foreground"></span>
              <span class="truncate text-xs font-medium">{{ file.name }}</span>
            </div>
            <div class="mt-1 flex items-center gap-2 pl-5.5 text-[10px] text-muted-foreground">
              <span class="rounded bg-muted px-1 py-px">{{ scopeLabel(file.scope) }}</span>
              <span>{{ formatSize(file.size) }}</span>
              <span>{{ formatDate(file.mtime) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：文件内容 -->
    <div class="flex-1 overflow-hidden bg-background">
      <template v-if="selectedFile">
        <div class="flex items-center justify-between border-b border-border px-6 py-3">
          <div>
            <h2 class="text-sm font-semibold">{{ selectedFile.name }}</h2>
            <p class="text-[10px] text-muted-foreground">
              {{ scopeLabel(selectedFile.scope) }} · {{ formatSize(selectedFile.size) }} ·
              {{ formatDate(selectedFile.mtime) }}
            </p>
          </div>
        </div>

        <div class="h-[calc(100%-52px)] overflow-y-auto p-6">
          <div v-if="contentLoading" class="flex items-center justify-center py-12">
            <span class="i-carbon-circle-dash inline-block h-5 w-5 animate-spin text-muted-foreground"></span>
          </div>
          <pre v-else class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground font-mono">{{
            fileContent
          }}</pre>
        </div>
      </template>

      <div v-else class="flex h-full flex-col items-center justify-center text-muted-foreground">
        <span class="i-carbon-cognitive mb-3 inline-block h-10 w-10 opacity-30"></span>
        <p class="text-sm">选择一个记忆文件查看内容</p>
        <p class="mt-1 text-[10px] text-muted-foreground/60">记忆由 Agent 在执行任务时自动生成和维护</p>
      </div>
    </div>
  </div>
</template>
