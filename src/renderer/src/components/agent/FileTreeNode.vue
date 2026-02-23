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
const onAddToChat = inject<((node: FileNode) => void) | undefined>('addToChat', undefined);
const onAddFileToTask = inject<((node: FileNode) => void) | undefined>('addFileToTask', undefined);
const selectedPath = inject<Ref<string | null>>('selectedPath');
const onCopyToDir = inject<((sourcePath: string, targetDir: string) => Promise<void>) | undefined>(
  'copyToDir',
  undefined
);
const onUploadFile = inject<((file: File, targetDir: string) => Promise<void>) | undefined>('uploadFile', undefined);
const onDeleteNode = inject<((nodePath: string) => Promise<void>) | undefined>('deleteNode', undefined);

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

// 删除文件/目录
async function deleteNode(): Promise<void> {
  if (contextNode.value && onDeleteNode) {
    await onDeleteNode(contextNode.value.path);
  }
  menuVisible.value = false;
}

function isExpanded(nodePath: string): boolean {
  return expandedDirs.value.has(nodePath);
}

function isSelected(nodePath: string): boolean {
  return selectedPath?.value === nodePath;
}

// 处理节点点击
function handleNodeClick(node: FileNode): void {
  // 设置选中状态（用于粘贴功能确定目标目录）
  if (selectedPath) {
    selectedPath.value = node.path;
  }

  if (node.type === 'directory') {
    onToggleDir(node);
  } else {
    onOpenFile(node.path);
  }
}

// 拖拽状态
const isNodeDragOver = ref(false);

// 处理拖拽进入
function handleDragEnter(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  isNodeDragOver.value = true;
}

// 处理拖拽离开
function handleDragLeave(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  isNodeDragOver.value = false;
}

// 处理拖拽悬停
function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

// 处理文件放下
async function handleDrop(event: DragEvent, node: FileNode): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  isNodeDragOver.value = false;

  if (!onCopyToDir && !onUploadFile) {
    return;
  }

  // 确定目标目录
  const targetDir = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));

  const files = event.dataTransfer?.files;

  if (!files || files.length === 0) {
    // 尝试从文本获取路径
    const text = event.dataTransfer?.getData('text');
    if (text && onCopyToDir) {
      await onCopyToDir(text.trim(), targetDir);
    }
    return;
  }

  // 处理拖入的文件
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = (file as File & { path?: string }).path;

    if (filePath && onCopyToDir) {
      // 如果有 path 属性（Electron 提供），直接复制
      await onCopyToDir(filePath, targetDir);
    } else if (onUploadFile) {
      // 否则上传文件内容
      await onUploadFile(file, targetDir);
    }
  }
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
        'file-tree-node-drag-over': isNodeDragOver,
        'text-gray-600': !isSelected(node.path),
        'text-gray-800': isSelected(node.path)
      }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="handleNodeClick(node)"
      @contextmenu="handleContextMenu($event, node)"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="(e) => handleDrop(e, node)">
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
        <span>复制路径</span>
      </ContextMenuItem>
      <ContextMenuItem v-if="onDeleteNode" @click="deleteNode">
        <span class="i-carbon-trash-can inline-block h-3.5 w-3.5 text-red-500" />
        <span class="text-red-500">删除</span>
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
  background: hsl(var(--primary) / 0.2);
}

.file-tree-node-selected:hover::before {
  background: hsl(var(--primary) / 0.26);
}

.file-tree-node-drag-over::before {
  background: hsl(var(--primary) / 0.3);
  border: 1px dashed hsl(var(--primary));
}

.file-tree-node > * {
  position: relative;
  z-index: 1;
}
</style>
