/**
 * Gateway Agents 方法组
 *
 * 方法：
 *   agents.list   — 列出所有已注册 Agent（轻量索引）
 *   agents.get    — 获取 Agent 完整定义
 *   agents.delete — 删除 Agent
 */

import { AgentStore } from '@main/ai/agents/AgentStore'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'

export const agentsMethods: MethodGroup = {
  namespace: 'agents',
  methods: {
    /** 创建新 Agent（前端 UI 表单） */
    create: async (params) => {
      const { id, name, description, instructions, tools, skills } = params as {
        id: string
        name: string
        description: string
        instructions: string
        tools?: string[]
        skills?: string[]
      }

      if (!id || !name || !description || !instructions) {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          'id, name, description, instructions are required'
        )
      }

      const store = await AgentStore.getInstance()
      try {
        const agent = await store.create({
          id,
          name,
          description,
          instructions,
          tools,
          skills,
          createdBy: 'user'
        })
        return { agent }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, msg)
      }
    },

    list: async () => {
      const store = await AgentStore.getInstance()
      const agents = await store.list()
      return { agents }
    },

    get: async (params) => {
      const { agentId } = params as { agentId?: string }
      if (!agentId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'agentId is required')
      }

      const store = await AgentStore.getInstance()
      const agent = await store.get(agentId)
      if (!agent) {
        throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, `Agent "${agentId}" not found`)
      }

      return { agent }
    },

    delete: async (params) => {
      const { agentId } = params as { agentId?: string }
      if (!agentId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'agentId is required')
      }

      const store = await AgentStore.getInstance()
      const deleted = await store.delete(agentId)
      if (!deleted) {
        throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, `Agent "${agentId}" not found`)
      }

      return { agentId, deleted: true }
    }
  }
}
