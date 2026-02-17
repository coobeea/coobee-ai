/**
 * manage_agent — Agent 管理工具
 *
 * 让 LLM 管理 Agent 定义的 CRUD 操作。
 * 工具本身只做持久化操作，不做"智能推导"。
 * Agent 定义的智能生成由 LLM + agent-creator Skill 完成。
 *
 * 支持操作：
 *   - create  — 创建新 Agent
 *   - list    — 列出所有 Agent（轻量索引）
 *   - get     — 获取 Agent 完整定义
 *   - update  — 更新 Agent 定义（部分更新，版本递增）
 *   - delete  — 删除 Agent
 *
 * 分类：Configuration | 风险：中（写操作改变系统行为）
 */

import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'
import { AgentStore } from '../../agents/AgentStore'

// ==================== 参数 Schema ====================

const paramsSchema = z.object({
  action: z
    .enum(['create', 'list', 'get', 'update', 'delete'])
    .describe('Operation to perform on agents'),

  // create / get / update / delete 需要 agentId
  agentId: z
    .string()
    .optional()
    .describe(
      'Agent ID (kebab-case). Required for create/get/update/delete. ' +
        'Example: "code-reviewer", "contract-analyst"'
    ),

  // create 参数
  name: z.string().optional().describe('Display name for the agent (Chinese or English)'),
  description: z
    .string()
    .optional()
    .describe('One-line description of the agent purpose and capabilities'),
  instructions: z
    .string()
    .optional()
    .describe('System instructions defining agent personality, expertise, and behavior rules'),
  tools: z
    .array(z.string())
    .optional()
    .describe(
      'List of tool names to enable. Omit to inherit all tools. ' +
        'Available: read, write, edit, exec, process, memory, search, glob, etc.'
    ),
  skills: z
    .array(z.string())
    .optional()
    .describe('List of skill names to associate with this agent'),
  model: z.string().optional().describe('Model ID to use (omit for global default)'),
  thinkingLevel: z
    .enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional()
    .describe('Thinking/reasoning depth level'),
  createdBy: z
    .enum(['user', 'agent'])
    .optional()
    .describe('Creator type: "user" for manual creation, "agent" for autonomous creation'),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional metadata key-value pairs')
})

// ==================== 工具定义 ====================

export const manageAgentTool: ToolDefinition = {
  name: 'manage_agent',
  description:
    'Manage Agent definitions — create, list, get, update, or delete specialized Agents. ' +
    'Agents are persistent configurations that define specialized assistants with custom instructions, tools, and skills. ' +
    'Use "create" to register a new agent, "list" to see available agents, "get" to read full definition, ' +
    '"update" to modify an existing agent (version auto-increments), "delete" to remove one. ' +
    'Created agents can later be invoked via delegate_to_agent tool.',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  parameters: paramsSchema,

  execute: async function* (
    params: Record<string, unknown>
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string

    try {
      const store = AgentStore.getInstance()

      switch (action) {
        case 'create':
          return yield* handleCreate(store, params)
        case 'list':
          return yield* handleList(store)
        case 'get':
          return yield* handleGet(store, params)
        case 'update':
          return yield* handleUpdate(store, params)
        case 'delete':
          return yield* handleDelete(store, params)
        default:
          return {
            success: false,
            error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` }
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: { code: 'AGENT_STORE_ERROR', message: msg } }
    }
  }
}

// ==================== 操作处理 ====================

async function* handleCreate(
  store: AgentStore,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const agentId = params.agentId as string | undefined
  if (!agentId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'agentId is required for create' }
    }
  }

  const name = params.name as string | undefined
  const description = params.description as string | undefined
  const instructions = params.instructions as string | undefined

  if (!name || !description || !instructions) {
    return {
      success: false,
      error: {
        code: 'MISSING_PARAM',
        message: 'name, description, and instructions are required for create'
      }
    }
  }

  yield { type: 'progress', content: `Creating agent "${agentId}"...` }

  const definition = await store.create({
    id: agentId,
    name,
    description,
    instructions,
    tools: params.tools as string[] | undefined,
    skills: params.skills as string[] | undefined,
    model: params.model as string | undefined,
    thinkingLevel: params.thinkingLevel as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | undefined,
    createdBy: (params.createdBy as 'user' | 'agent') ?? 'agent',
    metadata: params.metadata as Record<string, unknown> | undefined
  })

  return {
    success: true,
    llmContent: `Agent created successfully.\n\n${formatDefinitionSummary(definition)}`,
    userContent: `已创建 Agent: **${definition.name}** (${definition.id})`
  }
}

// eslint-disable-next-line require-yield
async function* handleList(
  store: AgentStore
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const entries = await store.list()

  if (entries.length === 0) {
    return {
      success: true,
      llmContent: 'No agents registered. Use action="create" to create one.',
      userContent: '暂无已注册的 Agent'
    }
  }

  const lines = entries.map(
    (e) => `- **${e.name}** (\`${e.id}\`) — ${e.description} [v${e.version}, by ${e.createdBy}]`
  )

  return {
    success: true,
    llmContent: `Registered agents (${entries.length}):\n\n${lines.join('\n')}`,
    userContent: `已注册 Agent (${entries.length}):\n\n${lines.join('\n')}`
  }
}

// eslint-disable-next-line require-yield
async function* handleGet(
  store: AgentStore,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const agentId = params.agentId as string | undefined
  if (!agentId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'agentId is required for get' }
    }
  }

  const definition = await store.get(agentId)
  if (!definition) {
    return { success: false, error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` } }
  }

  return {
    success: true,
    llmContent: JSON.stringify(definition, null, 2),
    userContent: formatDefinitionSummary(definition)
  }
}

async function* handleUpdate(
  store: AgentStore,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const agentId = params.agentId as string | undefined
  if (!agentId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'agentId is required for update' }
    }
  }

  yield { type: 'progress', content: `Updating agent "${agentId}"...` }

  const updated = await store.update(agentId, {
    name: params.name as string | undefined,
    description: params.description as string | undefined,
    instructions: params.instructions as string | undefined,
    tools: params.tools as string[] | undefined,
    skills: params.skills as string[] | undefined,
    model: params.model as string | undefined,
    thinkingLevel: params.thinkingLevel as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | undefined,
    metadata: params.metadata as Record<string, unknown> | undefined
  })

  if (!updated) {
    return { success: false, error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` } }
  }

  return {
    success: true,
    llmContent: `Agent updated successfully (v${updated.version}).\n\n${formatDefinitionSummary(updated)}`,
    userContent: `已更新 Agent: **${updated.name}** (${updated.id}) → v${updated.version}`
  }
}

// eslint-disable-next-line require-yield
async function* handleDelete(
  store: AgentStore,
  params: Record<string, unknown>
): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const agentId = params.agentId as string | undefined
  if (!agentId) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'agentId is required for delete' }
    }
  }

  const deleted = await store.delete(agentId)
  if (!deleted) {
    return { success: false, error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` } }
  }

  return {
    success: true,
    llmContent: `Agent "${agentId}" deleted successfully.`,
    userContent: `已删除 Agent: ${agentId}`
  }
}

// ==================== 格式化 ====================

function formatDefinitionSummary(def: {
  id: string
  name: string
  description: string
  version: number
  createdBy: string
  tools?: string[]
  skills?: string[]
  model?: string
  thinkingLevel?: string
}): string {
  const lines = [
    `ID: ${def.id}`,
    `Name: ${def.name}`,
    `Description: ${def.description}`,
    `Version: ${def.version}`,
    `Created by: ${def.createdBy}`
  ]
  if (def.tools?.length) lines.push(`Tools: ${def.tools.join(', ')}`)
  if (def.skills?.length) lines.push(`Skills: ${def.skills.join(', ')}`)
  if (def.model) lines.push(`Model: ${def.model}`)
  if (def.thinkingLevel) lines.push(`Thinking: ${def.thinkingLevel}`)
  return lines.join('\n')
}
