/**
 * Agent 列表 Store
 *
 * 管理前端的 Agent 列表状态，通过 HTTP REST API 获取数据。
 * AI 创建使用 SSE（Server-Sent Events）接收实时进度。
 * 接口基于 Gateway HTTP 路由（/gateway/agents/*）。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import configManager from '@/config';

/** Agent 索引条目（前端使用的轻量版） */
export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  createdBy: 'user' | 'agent' | 'system';
  version: number;
  updatedAt: string;
  /** Agent 完整定义中的 tools 字段 */
  tools?: string[];
  /** Agent 完整定义中的 skills 字段 */
  skills?: string[];
}

/** AI 创建进度步骤 */
export type AiCreateStep = 'analyzing' | 'generating' | 'validating' | 'saving' | 'done' | 'error';

/** AI 创建进度事件 */
export interface AiCreateProgress {
  step: AiCreateStep;
  message: string;
  detail?: string;
}

/** HTTP 基础路径 */
const BASE_URL = `${configManager.getBaseUrl()}/gateway/agents`;

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

export const useAgentsStore = defineStore('agents', () => {
  // ==================== State ====================

  const agents = ref<AgentEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** 当前选中的 Agent ID（用于切换对话 Agent） */
  const selectedAgentId = ref<string | null>(null);

  /** AI 创建状态 */
  const aiCreating = ref(false);
  const aiCreateError = ref<string | null>(null);

  /** AI 创建进度（SSE 实时更新） */
  const aiCreateSteps = ref<AiCreateProgress[]>([]);
  const aiCreateCurrentStep = ref<AiCreateStep | null>(null);

  // ==================== Getters ====================

  const agentCount = computed(() => agents.value.length);

  const selectedAgent = computed(() => agents.value.find((a) => a.id === selectedAgentId.value) ?? null);

  // ==================== Actions ====================

  /** 加载 Agent 列表 */
  async function fetchAgents(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiRequest<{ agents: AgentEntry[] }>('');
      // 系统内置 Agent 排在最前
      agents.value = result.agents.sort((a, b) => {
        if (a.createdBy === 'system' && b.createdBy !== 'system') return -1;
        if (a.createdBy !== 'system' && b.createdBy === 'system') return 1;
        return 0;
      });
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[AgentsStore] Failed to fetch agents:', err);
    } finally {
      loading.value = false;
    }
  }

  /** 创建 Agent（手动表单） */
  async function createAgent(params: {
    id: string;
    name: string;
    description: string;
    instructions: string;
  }): Promise<boolean> {
    try {
      await apiRequest<{ agent: AgentEntry }>('', {
        method: 'POST',
        body: JSON.stringify(params)
      });
      await fetchAgents();
      return true;
    } catch (err) {
      console.warn('[AgentsStore] Failed to create agent:', err);
      return false;
    }
  }

  /**
   * AI 驱动创建 Agent（自然语言需求）
   *
   * 通过 SSE 接收实时进度，前端可展示每个步骤。
   */
  async function aiCreateAgent(requirement: string): Promise<boolean> {
    aiCreating.value = true;
    aiCreateError.value = null;
    aiCreateSteps.value = [];
    aiCreateCurrentStep.value = 'analyzing';

    return new Promise((resolve) => {
      const url = `${BASE_URL}/ai-create`;

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement })
      })
        .then(async (response) => {
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('SSE 流不可用');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            let currentEvent = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const data = line.slice(6);
                try {
                  const parsed = JSON.parse(data);
                  if (currentEvent === 'progress') {
                    const progress = parsed as AiCreateProgress;
                    aiCreateSteps.value = [...aiCreateSteps.value, progress];
                    aiCreateCurrentStep.value = progress.step;
                  } else if (currentEvent === 'result') {
                    // 创建成功
                    await fetchAgents();
                    aiCreating.value = false;
                    aiCreateCurrentStep.value = 'done';
                    resolve(true);
                    return;
                  } else if (currentEvent === 'error') {
                    aiCreateError.value = (parsed as { error: string }).error;
                    aiCreating.value = false;
                    aiCreateCurrentStep.value = 'error';
                    resolve(false);
                    return;
                  }
                } catch {
                  // JSON 解析失败，忽略
                }
              }
            }
          }

          // 流结束但没有收到 result/error 事件
          if (aiCreating.value) {
            aiCreating.value = false;
            resolve(false);
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          aiCreateError.value = msg;
          aiCreating.value = false;
          aiCreateCurrentStep.value = 'error';
          console.warn('[AgentsStore] AI create agent failed:', err);
          resolve(false);
        });
    });
  }

  /** 删除 Agent */
  async function deleteAgent(agentId: string): Promise<boolean> {
    try {
      await apiRequest<{ agentId: string; deleted: boolean }>(`/${agentId}`, {
        method: 'DELETE'
      });
      agents.value = agents.value.filter((a) => a.id !== agentId);
      if (selectedAgentId.value === agentId) {
        selectedAgentId.value = null;
      }
      return true;
    } catch (err) {
      console.warn('[AgentsStore] Failed to delete agent:', err);
      return false;
    }
  }

  /** 更新 Agent（部分更新，如修改 skills） */
  async function updateAgent(agentId: string, params: { skills?: string[] }): Promise<boolean> {
    try {
      await apiRequest<{ agent: AgentEntry }>(`/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify(params)
      });
      await fetchAgents();
      return true;
    } catch (err) {
      console.warn('[AgentsStore] Failed to update agent:', err);
      return false;
    }
  }

  /** 选中 Agent */
  function selectAgent(agentId: string | null): void {
    selectedAgentId.value = agentId;
  }

  /** 重置 AI 创建状态 */
  function resetAiCreateState(): void {
    aiCreating.value = false;
    aiCreateError.value = null;
    aiCreateSteps.value = [];
    aiCreateCurrentStep.value = null;
  }

  return {
    // State
    agents,
    loading,
    error,
    selectedAgentId,
    aiCreating,
    aiCreateError,
    aiCreateSteps,
    aiCreateCurrentStep,
    // Getters
    agentCount,
    selectedAgent,
    // Actions
    fetchAgents,
    createAgent,
    aiCreateAgent,
    deleteAgent,
    updateAgent,
    selectAgent,
    resetAiCreateState
  };
});
