/**
 * Thread（会话线程）Store
 *
 * 管理前端的 Thread 列表状态，通过 HTTP REST API 获取数据。
 * 接口基于 Gateway HTTP 路由（/gateway/threads/*）。
 *
 * Thread = 一次对话会话，使用 Snowflake ID（有序），
 * 按 ID 降序排列 = 最新在前。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import configManager from '@/config';

/** Thread 索引条目 */
export interface ThreadEntry {
  id: string;
  title: string;
  agentId: string;
  status: 'active' | 'archived' | 'deleted';
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** HTTP 基础路径 */
const BASE_URL = `${configManager.getBaseUrl()}/gateway/threads`;

/** 统一的 HTTP 请求封装 */
async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = (data as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export const useThreadsStore = defineStore('threads', () => {
  // ==================== State ====================

  const threads = ref<ThreadEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** 当前活跃的 Thread ID */
  const activeThreadId = ref<string | null>(null);

  // ==================== Getters ====================

  const threadCount = computed(() => threads.value.length);

  const activeThread = computed(() => threads.value.find((t) => t.id === activeThreadId.value) ?? null);

  /** 按 agentId 分组的 threads */
  const threadsByAgent = computed(() => {
    const map = new Map<string, ThreadEntry[]>();
    for (const t of threads.value) {
      const list = map.get(t.agentId) ?? [];
      list.push(t);
      map.set(t.agentId, list);
    }
    return map;
  });

  // ==================== Actions ====================

  /** 加载 Thread 列表 */
  async function fetchThreads(agentId?: string): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      const result = await apiRequest<{ threads: ThreadEntry[] }>(query);
      threads.value = result.threads;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[ThreadsStore] Failed to fetch threads:', err);
    } finally {
      loading.value = false;
    }
  }

  /** 创建 Thread */
  async function createThread(title: string, agentId: string): Promise<ThreadEntry | null> {
    try {
      const result = await apiRequest<{ thread: ThreadEntry }>('', {
        method: 'POST',
        body: JSON.stringify({ title, agentId })
      });
      // 新创建的 thread 插入列表头部（最新在前）
      threads.value = [result.thread, ...threads.value];
      activeThreadId.value = result.thread.id;
      return result.thread;
    } catch (err) {
      console.warn('[ThreadsStore] Failed to create thread:', err);
      return null;
    }
  }

  /** 更新 Thread（部分更新，如标题、消息数等） */
  async function updateThread(
    threadId: string,
    params: { title?: string; messageCount?: number; status?: string }
  ): Promise<boolean> {
    try {
      const result = await apiRequest<{ thread: ThreadEntry }>(`/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify(params)
      });
      // 更新本地列表
      const idx = threads.value.findIndex((t) => t.id === threadId);
      if (idx >= 0) {
        threads.value[idx] = result.thread;
      }
      return true;
    } catch (err) {
      console.warn('[ThreadsStore] Failed to update thread:', err);
      return false;
    }
  }

  /** 删除 Thread */
  async function deleteThread(threadId: string): Promise<boolean> {
    try {
      await apiRequest<{ threadId: string; deleted: boolean }>(`/${threadId}`, {
        method: 'DELETE'
      });
      threads.value = threads.value.filter((t) => t.id !== threadId);
      if (activeThreadId.value === threadId) {
        activeThreadId.value = null;
      }
      return true;
    } catch (err) {
      console.warn('[ThreadsStore] Failed to delete thread:', err);
      return false;
    }
  }

  /** 选中 Thread */
  function selectThread(threadId: string | null): void {
    activeThreadId.value = threadId;
  }

  return {
    // State
    threads,
    loading,
    error,
    activeThreadId,
    // Getters
    threadCount,
    activeThread,
    threadsByAgent,
    // Actions
    fetchThreads,
    createThread,
    updateThread,
    deleteThread,
    selectThread
  };
});
