<script setup lang="ts">
/**
 * ProjectPanel — 项目空间（左栏）
 *
 * 显示项目目录的文件树，通过 HTTP API 获取目录结构。
 * 支持目录展开/折叠、文件类型图标、手动刷新。
 */
import { ref, watch, provide } from 'vue';
import configManager from '@/config';
import FileTreeNodeVue from './FileTreeNode.vue';

const projectPath = defineModel<string | null>('projectPath', { default: null });
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const tree = ref<FileNode[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expandedDirs = ref<Set<string>>(new Set());

const BASE_URL = `${configManager.getBaseUrl()}/gateway/files`;

async function fetchTree(dirPath: string, depth = 3): Promise<FileNode[]> {
  const url = `${BASE_URL}/tree?path=${encodeURIComponent(dirPath)}&depth=${depth}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return (data as { children: FileNode[] }).children;
}

async function loadTree(): Promise<void> {
  if (!projectPath.value) return;
  loading.value = true;
  error.value = null;
  try {
    tree.value = await fetchTree(projectPath.value);
    expandedDirs.value.clear();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    tree.value = [];
  } finally {
    loading.value = false;
  }
}

async function toggleDir(node: FileNode): Promise<void> {
  if (node.type !== 'directory') return;

  if (expandedDirs.value.has(node.path)) {
    expandedDirs.value.delete(node.path);
  } else {
    expandedDirs.value.add(node.path);
    if (!node.children || node.children.length === 0) {
      try {
        node.children = await fetchTree(node.path, 1);
      } catch {
        node.children = [];
      }
    }
  }
}

provide('expandedDirs', expandedDirs);
provide('toggleDir', toggleDir);

async function selectDirectory(): Promise<void> {
  try {
    const result = await window.api?.openDirectory();
    if (result) {
      projectPath.value = result;
    }
  } catch (err) {
    console.warn('[ProjectPanel] 选择目录失败:', err);
  }
}

watch(
  projectPath,
  (newPath) => {
    if (newPath) loadTree();
    else tree.value = [];
  },
  { immediate: true }
);

defineExpose({ selectDirectory });
</script>

<template>
  <aside v-show="!isCollapsed" class="flex h-full w-64 shrink-0 flex-col border-r border-gray-200/80 bg-gray-50/50">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-folder-shared inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">项目空间</span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          v-if="projectPath"
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="刷新"
          @click="loadTree">
          <span class="i-carbon-renew inline-block h-3 w-3" :class="{ 'animate-spin': loading }"></span>
        </button>
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
          title="折叠"
          @click="isCollapsed = true">
          <span class="i-carbon-chevron-left inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 未选择目录 -->
      <div v-if="!projectPath" class="flex flex-col items-center p-3 pt-12">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
          <span class="i-carbon-folder-add inline-block h-6 w-6 text-gray-400"></span>
        </div>
        <p class="mb-1 text-xs font-medium text-gray-500">选择项目目录</p>
        <p class="mb-4 text-center text-[11px] leading-relaxed text-gray-400">
          Agent 将以此目录下的文件<br />作为工作上下文
        </p>
        <button
          class="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
          @click="selectDirectory">
          <span class="i-carbon-folder-add inline-block h-3.5 w-3.5"></span>
          选择目录
        </button>
      </div>

      <!-- 已选择目录 -->
      <template v-else>
        <!-- 当前目录路径 -->
        <div class="border-b border-gray-200/60 px-3 py-2">
          <div class="flex items-center justify-between">
            <p class="max-w-[160px] truncate font-mono text-[11px] text-gray-600" :title="projectPath">
              {{ projectPath.split('/').pop() || projectPath }}
            </p>
            <button class="text-[10px] text-gray-400 transition hover:text-primary" @click="selectDirectory">
              切换
            </button>
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="loading && tree.length === 0" class="flex items-center gap-2 px-3 py-4 text-[11px] text-gray-400">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin"></span>
          <span>加载中...</span>
        </div>

        <!-- 错误 -->
        <div v-else-if="error" class="px-3 py-4">
          <div class="flex items-center gap-1.5 text-[11px] text-red-500">
            <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0"></span>
            <span class="truncate">{{ error }}</span>
          </div>
          <button class="mt-2 text-[10px] text-gray-400 transition hover:text-primary" @click="loadTree"> 重试 </button>
        </div>

        <!-- 文件树 -->
        <div v-else class="py-1">
          <FileTreeNodeVue v-for="node in tree" :key="node.path" :node="node" :depth="0" />
          <div v-if="tree.length === 0 && !loading" class="px-3 py-4 text-center text-[11px] text-gray-400">
            空目录
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>
