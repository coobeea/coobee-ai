/**
 * Agent 配置存储
 * 管理自定义 Agent 配置的 CRUD 操作
 */

import { SQLiteService } from '@main/common/database'
import fs from 'fs'
import path from 'path'

/**
 * Agent 配置定义
 */
export interface AgentConfigData {
  id: string
  name: string
  description?: string
  instructions: string
  model?: string
  tools?: string[] // 工具 ID 列表
  metadata?: Record<string, unknown>
  modelSettings?: Record<string, unknown> // SDK ModelSettings
  createdAt: number
  updatedAt: number
  isSystem?: boolean // 是否系统预设
}

/**
 * Agent 配置存储接口
 */
export interface IAgentConfigStore {
  /**
   * 初始化存储（创建表）
   */
  initialize(): Promise<void>

  /**
   * 保存 Agent 配置
   */
  saveConfig(config: Omit<AgentConfigData, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>

  /**
   * 更新 Agent 配置
   */
  updateConfig(id: string, config: Partial<AgentConfigData>): Promise<void>

  /**
   * 获取 Agent 配置
   */
  getConfig(id: string): Promise<AgentConfigData | null>

  /**
   * 列出所有 Agent 配置
   */
  listConfigs(options?: { isSystem?: boolean }): Promise<AgentConfigData[]>

  /**
   * 删除 Agent 配置
   */
  deleteConfig(id: string): Promise<void>
}

/**
 * Agent 配置存储实现
 */
export class AgentConfigStore implements IAgentConfigStore {
  private db: SQLiteService

  constructor() {
    this.db = SQLiteService.getInstance()
  }

  /**
   * 初始化存储（创建表）
   */
  async initialize(): Promise<void> {
    const schemaPath = path.join(__dirname, 'schemas', 'agent_configs.sql')
    const schema = fs.readFileSync(schemaPath, 'utf-8')

    // 分割并执行 SQL 语句
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const statement of statements) {
      await this.db.execute(statement)
    }
  }

  /**
   * 保存 Agent 配置
   */
  async saveConfig(
    config: Omit<AgentConfigData, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const id = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    await this.db.execute(
      `INSERT INTO agent_configs (
        id, name, description, instructions, model, tools, metadata, 
        created_at, updated_at, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        config.name,
        config.description || null,
        config.instructions,
        config.model || 'gpt-4o',
        config.tools ? JSON.stringify(config.tools) : null,
        config.metadata ? JSON.stringify(config.metadata) : null,
        now,
        now,
        config.isSystem ? 1 : 0
      ]
    )

    return id
  }

  /**
   * 更新 Agent 配置
   */
  async updateConfig(id: string, config: Partial<AgentConfigData>): Promise<void> {
    const updates: string[] = []
    const values: unknown[] = []

    if (config.name !== undefined) {
      updates.push('name = ?')
      values.push(config.name)
    }
    if (config.description !== undefined) {
      updates.push('description = ?')
      values.push(config.description)
    }
    if (config.instructions !== undefined) {
      updates.push('instructions = ?')
      values.push(config.instructions)
    }
    if (config.model !== undefined) {
      updates.push('model = ?')
      values.push(config.model)
    }
    if (config.tools !== undefined) {
      updates.push('tools = ?')
      values.push(JSON.stringify(config.tools))
    }
    if (config.metadata !== undefined) {
      updates.push('metadata = ?')
      values.push(JSON.stringify(config.metadata))
    }

    updates.push('updated_at = ?')
    values.push(Date.now())

    values.push(id)

    await this.db.execute(`UPDATE agent_configs SET ${updates.join(', ')} WHERE id = ?`, values)
  }

  /**
   * 获取 Agent 配置
   */
  async getConfig(id: string): Promise<AgentConfigData | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM agent_configs WHERE id = ?`,
      [id]
    )

    if (!row) {
      return null
    }

    return this.rowToConfig(row)
  }

  /**
   * 列出所有 Agent 配置
   */
  async listConfigs(options?: { isSystem?: boolean }): Promise<AgentConfigData[]> {
    let sql = 'SELECT * FROM agent_configs'
    const params: unknown[] = []

    if (options?.isSystem !== undefined) {
      sql += ' WHERE is_system = ?'
      params.push(options.isSystem ? 1 : 0)
    }

    sql += ' ORDER BY created_at DESC'

    const rows = await this.db.query<Record<string, unknown>>(sql, params)

    return rows.map((row) => this.rowToConfig(row))
  }

  /**
   * 删除 Agent 配置
   */
  async deleteConfig(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM agent_configs WHERE id = ?`, [id])
  }

  /**
   * 将数据库行转换为 AgentConfigData
   */
  private rowToConfig(row: Record<string, unknown>): AgentConfigData {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | undefined) || undefined,
      instructions: row.instructions as string,
      model: (row.model as string | undefined) || 'gpt-4o',
      tools: row.tools ? JSON.parse(row.tools as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      isSystem: row.is_system === 1
    }
  }
}

/**
 * 全局 Agent 配置存储实例
 */
export const agentConfigStore = new AgentConfigStore()
