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
  isTooLarge?: boolean;
  error?: string;
  size?: number;
  /** URL 预览模式标记（用于 iframe 预览） */
  isWebUrl?: boolean;
  // 分块加载相关
  chunked?: boolean;
  offset?: number;
  limit?: number;
  totalLines?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
}

const openFiles = ref<OpenFile[]>([]);
const activeFilePath = ref<string | null>(null);

const activeFile = computed(() => openFiles.value.find((f) => f.path === activeFilePath.value) ?? null);

const BASE_URL = `${configManager.getBaseUrl()}/gateway/files`;

async function fetchFileContent(
  filePath: string,
  offset?: number,
  limit?: number
): Promise<{
  content: string;
  language: string;
  name: string;
  size?: number;
  chunked?: boolean;
  offset?: number;
  limit?: number;
  totalLines?: number;
  hasMore?: boolean;
  error?: string;
}> {
  let url = `${BASE_URL}/content?path=${encodeURIComponent(filePath)}`;
  if (offset !== undefined) {
    url += `&offset=${offset}`;
  }
  if (limit !== undefined) {
    url += `&limit=${limit}`;
  }

  const res = await fetch(url);
  const data = await res.json();

  // 文件太大（413 错误 - 旧逻辑，现在不应该出现）
  if (res.status === 413) {
    return {
      content: '',
      language: 'plaintext',
      name: filePath.split('/').pop() || filePath,
      error: (data as { error?: string }).error || '文件过大'
    };
  }

  // 二进制文件（415 错误）
  if (res.status === 415) {
    return {
      content: '',
      language: 'plaintext',
      name: filePath.split('/').pop() || filePath,
      error: (data as { error?: string }).error || '不支持的文件类型'
    };
  }

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data as {
    content: string;
    language: string;
    name: string;
    size?: number;
    chunked?: boolean;
    offset?: number;
    limit?: number;
    totalLines?: number;
    hasMore?: boolean;
  };
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
      const target = openFiles.value.find((f) => f.path === filePath);
      if (!target) return;
      target.content = data.content;
      target.language = data.language;
      target.name = data.name;
      target.size = data.size;
      target.error = data.error;
      target.chunked = data.chunked;
      target.offset = data.offset ?? 0;
      target.limit = data.limit;
      target.totalLines = data.totalLines;
      target.hasMore = data.hasMore;
      target.loading = false;
    })
    .catch((err) => {
      const target = openFiles.value.find((f) => f.path === filePath);
      if (!target) return;
      target.content = `// Error loading file: ${err instanceof Error ? err.message : String(err)}`;
      target.language = 'plaintext';
      target.loading = false;
    });
}

/**
 * 加载更多内容（用于大文件分块加载）
 */
async function loadMoreContent(filePath: string): Promise<void> {
  const file = openFiles.value.find((f) => f.path === filePath);
  if (!file || !file.chunked || !file.hasMore || file.loadingMore) {
    return;
  }

  file.loadingMore = true;

  try {
    const nextOffset = (file.offset ?? 0) + (file.limit ?? 10000);
    const data = await fetchFileContent(filePath, nextOffset, file.limit);

    // 追加内容
    file.content += '\n' + data.content;
    file.offset = nextOffset;
    file.hasMore = data.hasMore;
    file.totalLines = data.totalLines;
  } catch (err) {
    console.error('[useOpenFiles] 加载更多失败:', err);
  } finally {
    file.loadingMore = false;
  }
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

/**
 * 在工作台打开 URL 预览（iframe）
 */
function openUrl(url: string, title?: string): void {
  const existing = openFiles.value.find((f) => f.path === url);
  if (existing) {
    activeFilePath.value = url;
    return;
  }

  let displayName = title || url;
  try {
    const parsed = new URL(url);
    displayName = title || `${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}`;
  } catch {
    // keep original
  }

  openFiles.value.push({
    path: url,
    name: displayName,
    language: 'html',
    content: '',
    loading: false,
    isWebUrl: true
  });
  activeFilePath.value = url;
}

export function useOpenFiles(): {
  openFiles: typeof openFiles;
  activeFilePath: typeof activeFilePath;
  activeFile: typeof activeFile;
  openFile: typeof openFile;
  openUrl: typeof openUrl;
  closeFile: typeof closeFile;
  closeAllFiles: typeof closeAllFiles;
  activateFile: typeof activateFile;
  loadMoreContent: typeof loadMoreContent;
} {
  return {
    openFiles,
    activeFilePath,
    activeFile,
    openFile,
    openUrl,
    closeFile,
    closeAllFiles,
    activateFile,
    loadMoreContent
  };
}
