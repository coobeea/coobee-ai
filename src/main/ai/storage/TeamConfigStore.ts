/**
 * Team 配置存储
 * 管理 Team 配置的 CRUD 操作
 */

import { SQLiteService } from '@main/common/database'
import type { TeamConfig, TeamMember } from '../teams/types'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * Team 配置存储接口
 */
export interface ITeamConfigStore {
  initialize(): Promise<void>
  saveTeam(config: Omit<TeamConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>
  updateTeam(id: string, config: Partial<TeamConfig>): Promise<void>
  getTeam(id: string): Promise<TeamConfig | null>
  listTeams(): Promise<TeamConfig[]>
  deleteTeam(id: string): Promise<void>
}

/**
 * Team 配置存储实现
 */
export class TeamConfigStore implements ITeamConfigStore {
  private db: SQLiteService

  constructor() {
    this.db = SQLiteService.getInstance()
  }

  async initialize(): Promise<void> {
    // 执行 SQL schema
    const schemaPath = join(__dirname, 'schemas', 'team_configs.sql')
    try {
      const schema = await readFile(schemaPath, 'utf-8')
      await this.db.execute(schema)
      console.log('[TeamConfigStore] Schema initialized')
    } catch (error) {
      console.error('[TeamConfigStore] Failed to initialize schema:', error)
      // 如果文件不存在，直接执行 SQL
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS team_configs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          orchestration_type TEXT NOT NULL,
          routing_rules JSON,
          metadata JSON,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS team_members (
          id TEXT PRIMARY KEY,
          team_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          role TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (team_id) REFERENCES team_configs(id) ON DELETE CASCADE,
          FOREIGN KEY (agent_id) REFERENCES agent_configs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
        CREATE INDEX IF NOT EXISTS idx_team_members_agent_id ON team_members(agent_id);
      `)
    }
  }

  /**
   * 保存 Team 配置
   */
  async saveTeam(config: Omit<TeamConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const now = Date.now()

    // 1. 保存 Team 基本信息
    await this.db.execute(
      `INSERT INTO team_configs (id, name, description, orchestration_type, routing_rules, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        config.name,
        config.description || null,
        config.orchestrationType,
        JSON.stringify(config.routingRules || []),
        JSON.stringify(config.metadata || {}),
        now,
        now
      ]
    )

    // 2. 保存 Team 成员
    for (const member of config.members) {
      const memberId = `member_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      await this.db.execute(
        `INSERT INTO team_members (id, team_id, agent_id, role, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [memberId, teamId, member.agentId, member.role, member.priority || 0, now]
      )
    }

    console.log(`[TeamConfigStore] Saved team: ${teamId}`)
    return teamId
  }

  /**
   * 更新 Team 配置
   */
  async updateTeam(id: string, config: Partial<TeamConfig>): Promise<void> {
    const now = Date.now()
    const updates: string[] = []
    const params: unknown[] = []

    if (config.name !== undefined) {
      updates.push('name = ?')
      params.push(config.name)
    }

    if (config.description !== undefined) {
      updates.push('description = ?')
      params.push(config.description)
    }

    if (config.orchestrationType !== undefined) {
      updates.push('orchestration_type = ?')
      params.push(config.orchestrationType)
    }

    if (config.routingRules !== undefined) {
      updates.push('routing_rules = ?')
      params.push(JSON.stringify(config.routingRules))
    }

    if (config.metadata !== undefined) {
      updates.push('metadata = ?')
      params.push(JSON.stringify(config.metadata))
    }

    updates.push('updated_at = ?')
    params.push(now)

    params.push(id)

    if (updates.length > 1) {
      await this.db.execute(`UPDATE team_configs SET ${updates.join(', ')} WHERE id = ?`, params)
    }

    // 更新成员（如果提供）
    if (config.members) {
      // 删除旧成员
      await this.db.execute(`DELETE FROM team_members WHERE team_id = ?`, [id])

      // 添加新成员
      for (const member of config.members) {
        const memberId = `member_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        await this.db.execute(
          `INSERT INTO team_members (id, team_id, agent_id, role, priority, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [memberId, id, member.agentId, member.role, member.priority || 0, now]
        )
      }
    }

    console.log(`[TeamConfigStore] Updated team: ${id}`)
  }

  /**
   * 获取 Team 配置
   */
  async getTeam(id: string): Promise<TeamConfig | null> {
    // 1. 获取 Team 基本信息
    const teamRow = await this.db.queryOne(`SELECT * FROM team_configs WHERE id = ?`, [id])

    if (!teamRow) return null

    // 2. 获取成员列表
    const memberRows = await this.db.query(
      `SELECT * FROM team_members WHERE team_id = ? ORDER BY priority DESC`,
      [id]
    )

    const members: TeamMember[] = memberRows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      agentId: row.agent_id as string,
      role: row.role as string,
      priority: row.priority as number
    }))

    return {
      id: teamRow.id,
      name: teamRow.name,
      description: teamRow.description,
      orchestrationType: teamRow.orchestration_type,
      members,
      routingRules: JSON.parse(teamRow.routing_rules || '[]'),
      metadata: JSON.parse(teamRow.metadata || '{}'),
      createdAt: teamRow.created_at,
      updatedAt: teamRow.updated_at
    }
  }

  /**
   * 列出所有 Teams
   */
  async listTeams(): Promise<TeamConfig[]> {
    const rows = await this.db.query(`SELECT id FROM team_configs`)
    const teams: TeamConfig[] = []

    for (const row of rows) {
      const team = await this.getTeam(row.id)
      if (team) teams.push(team)
    }

    return teams
  }

  /**
   * 删除 Team
   */
  async deleteTeam(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM team_configs WHERE id = ?`, [id])
    // team_members 会通过 CASCADE 自动删除
    console.log(`[TeamConfigStore] Deleted team: ${id}`)
  }
}

/**
 * 全局 TeamConfigStore 实例
 */
export const teamConfigStore = new TeamConfigStore()
