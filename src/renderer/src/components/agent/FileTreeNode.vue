<script setup lang="ts">
/**
 * FileTreeNode — 递归文件树节点
 *
 * 递归渲染目录/文件节点。通过 provide/inject
 * 与 ProjectPanel 共享展开状态和操作函数。
 */
import { inject, ref, type Ref } from 'vue';
import ContextMenu from '../common/ContextMenu.vue';
import ContextMenuItem from '../common/ContextMenuItem.vue';

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
const onOpenFile = inject<(filePath: string) => void>('openFile')!;
const onAddToChat = inject<(node: FileNode) => void>('addToChat');
const onAddFileToTask = inject<(node: FileNode) => void>('addFileToTask');
const selectedPath = inject<Ref<string | null>>('selectedPath');

// 右键菜单状态
const menuVisible = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const contextNode = ref<FileNode | null>(null);

// 处理右键点击
function handleContextMenu(event: MouseEvent, node: FileNode): void {
  event.preventDefault();
  event.stopPropagation();

  contextNode.value = node;
  menuX.value = event.clientX;
  menuY.value = event.clientY;
  menuVisible.value = true;
}

// 添加到对话
function addToChat(): void {
  if (contextNode.value && onAddToChat) {
    onAddToChat(contextNode.value);
  }
  menuVisible.value = false;
}

// 添加到任务
function addToTask(): void {
  if (contextNode.value && onAddFileToTask) {
    onAddFileToTask(contextNode.value);
  }
  menuVisible.value = false;
}

// 复制文件路径
async function copyPath(): Promise<void> {
  if (contextNode.value) {
    try {
      await navigator.clipboard.writeText(contextNode.value.path);
      console.log('[FileTreeNode] 已复制路径:', contextNode.value.path);
    } catch (err) {
      console.error('[FileTreeNode] 复制失败:', err);
    }
  }
  menuVisible.value = false;
}

function isExpanded(nodePath: string): boolean {
  return expandedDirs.value.has(nodePath);
}

function isSelected(nodePath: string): boolean {
  return selectedPath?.value === nodePath;
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
      class="file-tree-node flex cursor-pointer items-center gap-1 py-[3px] pr-2 text-[11px] transition-all"
      :class="{
        'font-medium': node.type === 'directory',
        'file-tree-node-selected': isSelected(node.path),
        'text-gray-600': !isSelected(node.path),
        'text-gray-800': isSelected(node.path)
      }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="node.type === 'directory' ? onToggleDir(node) : onOpenFile(node.path)"
      @contextmenu="handleContextMenu($event, node)">
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

    <!-- 右键菜单 -->
    <ContextMenu v-model:visible="menuVisible" :x="menuX" :y="menuY">
      <ContextMenuItem v-if="onAddToChat" @click="addToChat">
        <span class="i-carbon-add inline-block h-3.5 w-3.5" />
        <span>添加到对话</span>
      </ContextMenuItem>
      <ContextMenuItem v-if="onAddFileToTask && node.type === 'file'" @click="addToTask">
        <span class="i-carbon-task-add inline-block h-3.5 w-3.5" />
        <span>添加到任务</span>
      </ContextMenuItem>
      <ContextMenuItem @click="copyPath">
        <span class="i-carbon-copy inline-block h-3.5 w-3.5" />
        <span>复制文件路径</span>
      </ContextMenuItem>
    </ContextMenu>
  </div>
</template>

<style scoped>
.file-tree-node {
  position: relative;
}

.file-tree-node::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: transparent;
  transition: background-color 0.15s ease;
  border-radius: 4px;
  margin: 0 4px;
}

.file-tree-node:hover::before {
  background: hsl(var(--muted) / 0.5);
}

.file-tree-node-selected::before {
  background: hsl(var(--primary) / 0.12);
}

.file-tree-node-selected:hover::before {
  background: hsl(var(--primary) / 0.16);
}

.file-tree-node > * {
  position: relative;
  z-index: 1;
}
</style>
