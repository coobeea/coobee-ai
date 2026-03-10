/**
 * CoreStore - 核心状态管理
 *
 * 整合 Agent、Thread、Config 的核心状态
 * 提供统一的数据流和状态同步机制
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import configManager from '@/config';

/** Agent 核心信息 */
export interface CoreAgent {
  id: string;
  name: string;
  description: string;
  createdBy: 'user' | 'agent' | 'system';
  version: number;
  updatedAt: string;
}

/** Thread 核心信息 */
export interface CoreThread {
  id: string;
  title: string;
  agentId: string;
  status: 'active' | 'archived' | 'deleted';
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
}

/** 应用配置 */
export interface CoreConfig {
  theme: 'light' | 'dark' | 'auto';
  language: 'zh-CN' | 'en-US';
  apiBaseUrl: string;
}

/**
 * 核心 Store
 *
 * 管理系统核心状态，提供统一的状态访问接口
 */
export const useCoreStore = defineStore('core', () => {
  // ==================== State ====================

  const agents = ref<CoreAgent[]>([]);
  const threads = ref<CoreThread[]>([]);
  const config = ref<CoreConfig>({
    theme: 'light',
    language: 'zh-CN',
    apiBaseUrl: configManager.getBaseUrl()
  });

  const loading = ref({
    agents: false,
    threads: false,
    config: false
  });

  const error = ref<string | null>(null);

  /** 当前活跃的 Agent ID */
  const activeAgentId = ref<string | null>(null);

  /** 当前活跃的 Thread ID */
  const activeThreadId = ref<string | null>(null);

  // ==================== Getters ====================

  const activeAgent = computed(() => agents.value.find((a) => a.id === activeAgentId.value) ?? null);

  const activeThread = computed(() => threads.value.find((t) => t.id === activeThreadId.value) ?? null);

  const threadsByAgent = computed(() => {
    const map = new Map<string, CoreThread[]>();
    for (const thread of threads.value) {
      const list = map.get(thread.agentId) ?? [];
      list.push(thread);
      map.set(thread.agentId, list);
    }
    return map;
  });

  // ==================== Actions ====================

  /**
   * 加载所有核心数据
   */
  async function loadAll(): Promise<void> {
    await Promise.all([fetchAgents(), fetchThreads()]);
  }

  /**
   * 加载 Agent 列表
   */
  async function fetchAgents(): Promise<void> {
    loading.value.agents = true;
    error.value = null;

    try {
      const res = await fetch(`${config.value.apiBaseUrl}/gateway/agents`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { agents: CoreAgent[] };
      agents.value = data.agents;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[CoreStore] 加载 Agent 失败:', err);
    } finally {
      loading.value.agents = false;
    }
  }

  /**
   * 加载 Thread 列表
   */
  async function fetchThreads(agentId?: string): Promise<void> {
    loading.value.threads = true;
    error.value = null;

    try {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`${config.value.apiBaseUrl}/gateway/threads${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { threads: CoreThread[] };
      threads.value = data.threads;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[CoreStore] 加载 Thread 失败:', err);
    } finally {
      loading.value.threads = false;
    }
  }

  /**
   * 设置活跃 Agent
   */
  function setActiveAgent(agentId: string | null): void {
    activeAgentId.value = agentId;
  }

  /**
   * 设置活跃 Thread
   */
  function setActiveThread(threadId: string | null): void {
    activeThreadId.value = threadId;
  }

  /**
   * 更新配置
   */
  function updateConfig(partial: Partial<CoreConfig>): void {
    config.value = { ...config.value, ...partial };
  }

  // ==================== 返回 ====================

  return {
    // State
    agents,
    threads,
    config,
    loading,
    error,
    activeAgentId,
    activeThreadId,

    // Getters
    activeAgent,
    activeThread,
    threadsByAgent,

    // Actions
    loadAll,
    fetchAgents,
    fetchThreads,
    setActiveAgent,
    setActiveThread,
    updateConfig
  };
});
