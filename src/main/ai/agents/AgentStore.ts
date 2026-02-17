/**
 * Agent 定义持久化存储
 *
 * 将 AgentDefinition 存储到 .home/agents/{agentId}.json，
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Agent 独立 JSON 文件（便于 LLM 直接读写、用户查看）
 *   - 内存索引（id → AgentIndexEntry）加速 list 操作
 *   - 全量读取按需（get 时才读文件）
 *   - 单例模式（通过 getInstance）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@main/common/logger'
import type {
  AgentDefinition,
  AgentIndexEntry,
  CreateAgentParams,
  UpdateAgentParams
} from './types'

const log = createLogger('agent-store')

// ==================== AgentStore ====================

export class AgentStore {
  private static instance: AgentStore | null = null

  private readonly agentsDir: string

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, AgentIndexEntry>()

  /** 是否已初始化 */
  private initialized = false

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir
  }

  // ==================== 单例 ====================

  static getInstance(): AgentStore {
    if (!AgentStore.instance) {
      // 延迟加载 Env，避免循环依赖
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Env } = require('../../common/env')
      AgentStore.instance = new AgentStore(Env.paths.agentsDir)
    }
    return AgentStore.instance
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    AgentStore.instance = null
  }

  // ==================== 初始化 ====================

  /** 确保目录存在并加载索引 */
  async init(): Promise<void> {
    if (this.initialized) return

    // 确保目录存在
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true })
    }

    // 扫描目录加载索引
    await this.rebuildIndex()
    this.initialized = true
    log.info(`[AgentStore] Initialized: ${this.index.size} agents loaded from ${this.agentsDir}`)
  }

  /** 扫描目录重建索引 */
  private async rebuildIndex(): Promise<void> {
    this.index.clear()
    const files = fs.readdirSync(this.agentsDir).filter((f) => f.endsWith('.json'))

    for (const file of files) {
      try {
        const filePath = path.join(this.agentsDir, file)
        const raw = fs.readFileSync(filePath, 'utf-8')
        const def = JSON.parse(raw) as AgentDefinition
        this.index.set(def.id, toIndexEntry(def))
      } catch (err) {
        log.warn(`[AgentStore] Failed to load ${file}:`, err)
      }
    }
  }

  // ==================== CRUD ====================

  /** 创建新 Agent */
  async create(params: CreateAgentParams): Promise<AgentDefinition> {
    await this.init()

    // 校验 ID 唯一性
    if (this.index.has(params.id)) {
      throw new Error(`Agent "${params.id}" already exists`)
    }

    // 校验 ID 格式（kebab-case）
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(params.id) && !/^[a-z0-9]$/.test(params.id)) {
      throw new Error(
        `Invalid agent ID "${params.id}". Must be kebab-case (lowercase letters, numbers, hyphens).`
      )
    }

    const now = new Date().toISOString()
    const definition: AgentDefinition = {
      id: params.id,
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      tools: params.tools,
      skills: params.skills,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy ?? 'agent',
      version: 1,
      metadata: params.metadata
    }

    // 写文件
    this.writeDefinition(definition)

    // 更新索引
    this.index.set(definition.id, toIndexEntry(definition))

    log.info(`[AgentStore] Created agent: ${definition.id} (v${definition.version})`)
    return definition
  }

  /** 获取 Agent 完整定义 */
  async get(agentId: string): Promise<AgentDefinition | null> {
    await this.init()

    if (!this.index.has(agentId)) return null

    const filePath = this.getFilePath(agentId)
    if (!fs.existsSync(filePath)) {
      this.index.delete(agentId)
      return null
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw) as AgentDefinition
    } catch (err) {
      log.warn(`[AgentStore] Failed to read agent ${agentId}:`, err)
      return null
    }
  }

  /** 列出所有 Agent（轻量索引） */
  async list(): Promise<AgentIndexEntry[]> {
    await this.init()
    return Array.from(this.index.values())
  }

  /** 更新 Agent 定义（部分更新，版本号自动递增） */
  async update(agentId: string, params: UpdateAgentParams): Promise<AgentDefinition | null> {
    const existing = await this.get(agentId)
    if (!existing) return null

    const updated: AgentDefinition = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.tools !== undefined && { tools: params.tools }),
      ...(params.skills !== undefined && { skills: params.skills }),
      ...(params.model !== undefined && { model: params.model }),
      ...(params.thinkingLevel !== undefined && { thinkingLevel: params.thinkingLevel }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    }

    // 写文件
    this.writeDefinition(updated)

    // 更新索引
    this.index.set(updated.id, toIndexEntry(updated))

    log.info(`[AgentStore] Updated agent: ${agentId} (v${updated.version})`)
    return updated
  }

  /** 删除 Agent */
  async delete(agentId: string): Promise<boolean> {
    await this.init()

    if (!this.index.has(agentId)) return false

    const filePath = this.getFilePath(agentId)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      this.index.delete(agentId)
      log.info(`[AgentStore] Deleted agent: ${agentId}`)
      return true
    } catch (err) {
      log.warn(`[AgentStore] Failed to delete agent ${agentId}:`, err)
      return false
    }
  }

  /** 检查 Agent 是否存在 */
  async has(agentId: string): Promise<boolean> {
    await this.init()
    return this.index.has(agentId)
  }

  // ==================== 内部方法 ====================

  private getFilePath(agentId: string): string {
    return path.join(this.agentsDir, `${agentId}.json`)
  }

  private writeDefinition(def: AgentDefinition): void {
    const filePath = this.getFilePath(def.id)
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8')
  }
}

// ==================== 辅助函数 ====================

/** 从完整定义提取索引条目 */
function toIndexEntry(def: AgentDefinition): AgentIndexEntry {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    createdBy: def.createdBy,
    version: def.version,
    updatedAt: def.updatedAt
  }
}
