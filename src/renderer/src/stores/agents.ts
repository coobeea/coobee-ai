/**
 * Agent 列表 Store
 *
 * 管理前端的 Agent 列表状态，通过 Gateway RPC 获取数据。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { gateway } from '@/plugins/gatewaySetup'

/** Agent 索引条目（前端使用的轻量版） */
export interface AgentEntry {
  id: string
  name: string
  description: string
  createdBy: 'user' | 'agent'
  version: number
  updatedAt: string
}

export const useAgentsStore = defineStore('agents', () => {
  // ==================== State ====================

  const agents = ref<AgentEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 当前选中的 Agent ID（用于切换对话 Agent） */
  const selectedAgentId = ref<string | null>(null)

  // ==================== Getters ====================

  const agentCount = computed(() => agents.value.length)

  const selectedAgent = computed(
    () => agents.value.find((a) => a.id === selectedAgentId.value) ?? null
  )

  // ==================== Actions ====================

  /** 加载 Agent 列表 */
  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await gateway.request<{ agents: AgentEntry[] }>('agents.list')
      agents.value = result.agents
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[AgentsStore] Failed to fetch agents:', err)
    } finally {
      loading.value = false
    }
  }

  /** 创建 Agent */
  async function createAgent(params: {
    id: string
    name: string
    description: string
    instructions: string
  }): Promise<boolean> {
    try {
      await gateway.request<{ agent: AgentEntry }>('agents.create', params)
      await fetchAgents()
      return true
    } catch (err) {
      console.warn('[AgentsStore] Failed to create agent:', err)
      return false
    }
  }

  /** 删除 Agent */
  async function deleteAgent(agentId: string): Promise<boolean> {
    try {
      await gateway.request<{ agentId: string; deleted: boolean }>('agents.delete', { agentId })
      agents.value = agents.value.filter((a) => a.id !== agentId)
      if (selectedAgentId.value === agentId) {
        selectedAgentId.value = null
      }
      return true
    } catch (err) {
      console.warn('[AgentsStore] Failed to delete agent:', err)
      return false
    }
  }

  /** 选中 Agent */
  function selectAgent(agentId: string | null): void {
    selectedAgentId.value = agentId
  }

  return {
    // State
    agents,
    loading,
    error,
    selectedAgentId,
    // Getters
    agentCount,
    selectedAgent,
    // Actions
    fetchAgents,
    createAgent,
    deleteAgent,
    selectAgent
  }
})
