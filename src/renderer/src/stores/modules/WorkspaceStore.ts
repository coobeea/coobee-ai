/**
 * WorkspaceStore - 工作空间状态管理
 *
 * 管理当前工作空间的文件树、打开的文件、编辑状态等
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/** 文件树节点 */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modified?: string;
}

/** 打开的文件 */
export interface OpenedFile {
  path: string;
  name: string;
  content: string;
  modified: boolean;
  language?: string;
}

/**
 * 工作空间 Store
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  // ==================== State ====================

  const currentWorkspace = ref<string | null>(null);
  const fileTree = ref<FileNode | null>(null);
  const openedFiles = ref<OpenedFile[]>([]);
  const activeFilePath = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // ==================== Getters ====================

  const activeFile = computed(() => openedFiles.value.find((f) => f.path === activeFilePath.value) ?? null);

  const hasUnsavedChanges = computed(() => openedFiles.value.some((f) => f.modified));

  // ==================== Actions ====================

  /**
   * 设置当前工作空间
   */
  function setWorkspace(workspacePath: string): void {
    currentWorkspace.value = workspacePath;
  }

  /**
   * 加载文件树
   */
  async function loadFileTree(): Promise<void> {
    if (!currentWorkspace.value) return;

    loading.value = true;
    error.value = null;

    try {
      // TODO: 调用后端 API 加载文件树
      // const res = await fetch(`/api/workspace/tree?path=${currentWorkspace.value}`);
      // const data = await res.json();
      // fileTree.value = data.tree;

      // 临时占位
      fileTree.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[WorkspaceStore] 加载文件树失败:', err);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 打开文件
   */
  function openFile(file: OpenedFile): void {
    const existing = openedFiles.value.find((f) => f.path === file.path);
    if (!existing) {
      openedFiles.value.push(file);
    }
    activeFilePath.value = file.path;
  }

  /**
   * 关闭文件
   */
  function closeFile(filePath: string): void {
    const index = openedFiles.value.findIndex((f) => f.path === filePath);
    if (index !== -1) {
      openedFiles.value.splice(index, 1);
    }

    if (activeFilePath.value === filePath) {
      activeFilePath.value = openedFiles.value.length > 0 ? openedFiles.value[0].path : null;
    }
  }

  /**
   * 关闭所有文件
   */
  function closeAllFiles(): void {
    openedFiles.value = [];
    activeFilePath.value = null;
  }

  /**
   * 更新文件内容
   */
  function updateFileContent(filePath: string, content: string): void {
    const file = openedFiles.value.find((f) => f.path === filePath);
    if (file) {
      file.content = content;
      file.modified = true;
    }
  }

  /**
   * 标记文件为已保存
   */
  function markFileSaved(filePath: string): void {
    const file = openedFiles.value.find((f) => f.path === filePath);
    if (file) {
      file.modified = false;
    }
  }

  // ==================== 返回 ====================

  return {
    // State
    currentWorkspace,
    fileTree,
    openedFiles,
    activeFilePath,
    loading,
    error,

    // Getters
    activeFile,
    hasUnsavedChanges,

    // Actions
    setWorkspace,
    loadFileTree,
    openFile,
    closeFile,
    closeAllFiles,
    updateFileContent,
    markFileSaved
  };
});
