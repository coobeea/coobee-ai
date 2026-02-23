<script setup lang="ts">
/**
 * WorkbenchPanel — 工作台（中栏）
 *
 * 支持多标签页的文件查看器。
 * 左侧 ProjectPanel 点击文件 → 在此处用 Monaco Editor 展示。
 * 无打开文件时显示空状态引导。
 */

import { ref, watch, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue';
import { monaco } from '@/utils/monaco-setup';
import { useOpenFiles } from '@/composables/useOpenFiles';

const { openFiles, activeFilePath, activeFile, closeFile, activateFile } = useOpenFiles();

const editorContainer = ref<HTMLDivElement | null>(null);
const editorInstance = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);

function initEditor(): void {
  if (!editorContainer.value || editorInstance.value) return;

  editorInstance.value = monaco.editor.create(editorContainer.value, {
    value: '',
    language: 'plaintext',
    theme: 'vs',
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 4,
      horizontalScrollbarSize: 4,
      useShadows: false
    },
    padding: { top: 8 }
  });
}

function updateEditorContent(): void {
  if (!editorInstance.value) return;

  const file = activeFile.value;
  if (!file || file.loading) {
    editorInstance.value.setValue('');
    return;
  }

  const model = editorInstance.value.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, file.language);
  }
  editorInstance.value.setValue(file.content);
  editorInstance.value.revealLine(1);
}

watch(
  () => {
    const f = activeFile.value;
    if (!f) return null;
    return `${f.path}::${f.loading}::${f.content.length}`;
  },
  async () => {
    if (openFiles.value.length > 0 && !editorInstance.value) {
      await nextTick();
      initEditor();
    }
    await nextTick();
    updateEditorContent();
  }
);

onMounted(async () => {
  if (openFiles.value.length > 0) {
    await nextTick();
    initEditor();
    updateEditorContent();
  }
});

onBeforeUnmount(() => {
  editorInstance.value?.dispose();
  editorInstance.value = null;
});

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'i-carbon-logo-typescript text-blue-500';
    case 'js':
    case 'jsx':
      return 'i-carbon-logo-javascript text-yellow-500';
    case 'vue':
      return 'i-carbon-application-web text-green-500';
    case 'json':
    case 'jsonl':
      return 'i-carbon-json text-amber-600';
    case 'md':
      return 'i-carbon-document text-gray-500';
    case 'css':
    case 'scss':
    case 'less':
      return 'i-carbon-color-palette text-pink-500';
    case 'html':
      return 'i-carbon-html text-orange-500';
    default:
      return 'i-carbon-document-blank text-gray-400';
  }
}
</script>

<template>
  <main class="flex h-full min-w-0 flex-1 flex-col bg-white">
    <!-- 无打开文件 — 空状态 -->
    <template v-if="openFiles.length === 0">
      <div class="flex h-10 shrink-0 items-center border-b border-gray-200/60 px-4">
        <div class="flex items-center gap-1.5">
          <span class="i-carbon-workspace inline-block h-3.5 w-3.5 text-gray-500"></span>
          <span class="text-xs font-semibold text-gray-600">工作台</span>
        </div>
      </div>
      <div class="flex flex-1 flex-col items-center justify-center">
        <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50">
          <span class="i-carbon-document-view inline-block h-8 w-8 text-gray-300"></span>
        </div>
        <p class="mb-1 text-sm font-medium text-gray-400">点击左侧文件查看内容</p>
        <p class="text-xs text-gray-300">支持语法高亮、多标签页浏览</p>
      </div>
    </template>

    <!-- 有打开文件 — 标签页 + 编辑器 -->
    <template v-else>
      <!-- 标签页栏 -->
      <div class="flex h-9 shrink-0 items-end overflow-x-auto border-b border-gray-200/60 bg-gray-50/80">
        <div
          v-for="file in openFiles"
          :key="file.path"
          class="tab-item"
          :class="{ active: file.path === activeFilePath }"
          :title="file.path"
          @click="activateFile(file.path)">
          <span :class="getFileIcon(file.name)" class="inline-block h-3 w-3 shrink-0"></span>
          <span class="max-w-[120px] truncate text-[11px]">{{ file.name }}</span>
          <button class="tab-close" @click.stop="closeFile(file.path)">
            <span class="i-carbon-close inline-block h-2.5 w-2.5"></span>
          </button>
        </div>
      </div>

      <!-- 加载中 -->
      <div v-if="activeFile?.loading" class="flex flex-1 items-center justify-center">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin text-gray-300"></span>
      </div>

      <!-- 文件太大提示 -->
      <div v-else-if="activeFile?.isTooLarge" class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50">
          <span class="i-carbon-warning-alt inline-block h-8 w-8 text-amber-500"></span>
        </div>
        <div class="text-center">
          <p class="mb-1 text-sm font-medium text-gray-700">文件过大，无法预览</p>
          <p class="max-w-md text-xs leading-relaxed text-gray-500">
            {{ activeFile.error || '当前文件超过 2MB，为避免性能问题已禁止加载。' }}
          </p>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-400">
          <span class="i-carbon-document inline-block h-3.5 w-3.5"></span>
          <span>{{ activeFile.name }}</span>
        </div>
      </div>

      <!-- Monaco Editor -->
      <div
        v-show="activeFile && !activeFile.loading && !activeFile.isTooLarge"
        ref="editorContainer"
        class="min-h-0 flex-1"></div>
    </template>
  </main>
</template>

<style scoped>
.tab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 32px;
  cursor: pointer;
  color: hsl(var(--muted-foreground) / 0.6);
  border-right: 1px solid hsl(var(--border) / 0.2);
  white-space: nowrap;
  transition: all 0.1s ease;
  position: relative;
}

.tab-item:hover {
  color: hsl(var(--foreground) / 0.8);
  background: hsl(var(--background));
}

.tab-item.active {
  color: hsl(var(--foreground) / 0.9);
  background: white;
  border-bottom: 2px solid hsl(var(--primary));
  font-weight: 500;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  opacity: 0;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.1s ease;
}

.tab-item:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: hsl(var(--foreground) / 0.1);
  color: hsl(var(--foreground) / 0.8);
}
</style>
