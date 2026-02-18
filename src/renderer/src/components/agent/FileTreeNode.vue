<script setup lang="ts">
/**
 * FileTreeNode — 递归文件树节点
 *
 * 递归渲染目录/文件节点。通过 provide/inject
 * 与 ProjectPanel 共享展开状态和操作函数。
 */
import { inject, type Ref } from 'vue';
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

defineProps<{
  node: FileNode;
  depth: number;
}>();

const expandedDirs = inject<Ref<Set<string>>>('expandedDirs')!;
const onToggleDir = inject<(node: FileNode) => void>('toggleDir')!;

function isExpanded(nodePath: string): boolean {
  return expandedDirs.value.has(nodePath);
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'i-carbon-logo-typescript';
    case 'js':
    case 'jsx':
      return 'i-carbon-logo-javascript';
    case 'vue':
      return 'i-carbon-application-web';
    case 'json':
      return 'i-carbon-json';
    case 'md':
      return 'i-carbon-document';
    case 'css':
    case 'scss':
    case 'less':
      return 'i-carbon-color-palette';
    case 'html':
      return 'i-carbon-html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return 'i-carbon-image';
    case 'yaml':
    case 'yml':
      return 'i-carbon-settings';
    default:
      return 'i-carbon-document-blank';
  }
}
</script>

<template>
  <div>
    <!-- 行 -->
    <div
      class="flex cursor-default items-center gap-1 py-[3px] pr-2 text-[11px] text-gray-600 transition-colors hover:bg-gray-100/80"
      :class="{ 'font-medium': node.type === 'directory' }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="node.type === 'directory' ? onToggleDir(node) : undefined">
      <!-- 箭头 -->
      <span
        v-if="node.type === 'directory'"
        class="i-carbon-chevron-right inline-block h-2.5 w-2.5 shrink-0 transition-transform duration-150"
        :class="{ 'rotate-90': isExpanded(node.path) }" />
      <span v-else class="inline-block h-2.5 w-2.5 shrink-0" />

      <!-- 图标 -->
      <span
        class="inline-block h-3.5 w-3.5 shrink-0"
        :class="[
          node.type === 'directory'
            ? isExpanded(node.path)
              ? 'i-carbon-folder-open text-amber-500'
              : 'i-carbon-folder text-amber-500'
            : `${getFileIcon(node.name)} text-gray-400`
        ]" />

      <!-- 文件名 -->
      <span class="truncate" :title="node.name">{{ node.name }}</span>
    </div>

    <!-- 子节点（递归） -->
    <template v-if="node.type === 'directory' && isExpanded(node.path) && node.children">
      <FileTreeNode v-for="child in node.children" :key="child.path" :node="child" :depth="depth + 1" />
    </template>
  </div>
</template>
