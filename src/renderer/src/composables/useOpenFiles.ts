/**
 * useOpenFiles — 工作台文件标签页状态管理
 *
 * 管理打开的文件列表、当前激活的标签页、文件内容缓存。
 * 使用全局单例模式，跨组件共享（ProjectPanel ↔ WorkbenchPanel）。
 */

import { ref, computed } from 'vue';
import configManager from '@/config';

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  loading: boolean;
}

const openFiles = ref<OpenFile[]>([]);
const activeFilePath = ref<string | null>(null);

const activeFile = computed(() => openFiles.value.find((f) => f.path === activeFilePath.value) ?? null);

const BASE_URL = `${configManager.getBaseUrl()}/gateway/files`;

async function fetchFileContent(filePath: string): Promise<{ content: string; language: string; name: string }> {
  const url = `${BASE_URL}/content?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data as { content: string; language: string; name: string };
}

function openFile(filePath: string): void {
  const existing = openFiles.value.find((f) => f.path === filePath);
  if (existing) {
    activeFilePath.value = filePath;
    return;
  }

  const name = filePath.split('/').pop() || filePath;
  const entry: OpenFile = {
    path: filePath,
    name,
    language: 'plaintext',
    content: '',
    loading: true
  };

  openFiles.value.push(entry);
  activeFilePath.value = filePath;

  fetchFileContent(filePath)
    .then((data) => {
      entry.content = data.content;
      entry.language = data.language;
      entry.name = data.name;
      entry.loading = false;
    })
    .catch((err) => {
      entry.content = `// Error loading file: ${err instanceof Error ? err.message : String(err)}`;
      entry.language = 'plaintext';
      entry.loading = false;
    });
}

function closeFile(filePath: string): void {
  const idx = openFiles.value.findIndex((f) => f.path === filePath);
  if (idx < 0) return;

  openFiles.value.splice(idx, 1);

  if (activeFilePath.value === filePath) {
    if (openFiles.value.length > 0) {
      const newIdx = Math.min(idx, openFiles.value.length - 1);
      activeFilePath.value = openFiles.value[newIdx].path;
    } else {
      activeFilePath.value = null;
    }
  }
}

function closeAllFiles(): void {
  openFiles.value = [];
  activeFilePath.value = null;
}

function activateFile(filePath: string): void {
  activeFilePath.value = filePath;
}

export function useOpenFiles(): {
  openFiles: typeof openFiles;
  activeFilePath: typeof activeFilePath;
  activeFile: typeof activeFile;
  openFile: typeof openFile;
  closeFile: typeof closeFile;
  closeAllFiles: typeof closeAllFiles;
  activateFile: typeof activateFile;
} {
  return {
    openFiles,
    activeFilePath,
    activeFile,
    openFile,
    closeFile,
    closeAllFiles,
    activateFile
  };
}
