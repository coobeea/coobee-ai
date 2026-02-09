/**
 * 长期记忆存储
 * 跨会话的持久化知识库
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import type { SQLiteConnection } from '@main/common/database'
import { generateSnowflakeId } from '@main/utils'
import type { LongTermMemoryEntry, LongTermMemoryType, MemoryQuery } from './types'

/**
 * 长期记忆存储
 */
export class LongTermMemoryStore {
  private initialized = false

  constructor(private db: SQLiteConnection) {}

  /**
   * 初始化（创建表）
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.createSchema()
    this.initialized = true
    console.log('[LongTermMemoryStore] Initialized')
  }

  /**
   * 创建数据库 Schema
   */
  private async createSchema(): Promise<void> {
    const schemaPath = join(__dirname, '../storage/schemas', 'long_term_memory.sql')
    try {
      const schema = await readFile(schemaPath, 'utf-8')
      await this.db.execute(schema)
    } catch (_error) {
      console.warn('[LongTermMemoryStore] Schema file not found, creating inline')
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS long_term_memory (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          context TEXT,
          importance INTEGER NOT NULL,
          user_id TEXT,
          session_id TEXT,
          embedding BLOB,
          access_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ltm_user_type 
          ON long_term_memory(user_id, type);

        CREATE INDEX IF NOT EXISTS idx_ltm_importance 
          ON long_term_memory(importance DESC);

        CREATE INDEX IF NOT EXISTS idx_ltm_created 
          ON long_term_memory(created_at DESC);
      `)
    }
  }

  /**
   * 保存记忆条目
   */
  async saveMemory(memory: {
    type: LongTermMemoryType
    content: string
    context?: string
    importance: number
    userId?: string
    sessionId?: string
    embedding?: number[]
  }): Promise<string> {
    const id = generateSnowflakeId()
    const now = Date.now()

    await this.db.execute(
      `INSERT INTO long_term_memory 
       (id, type, content, context, importance, user_id, session_id, embedding, access_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.type,
        memory.content,
        memory.context || null,
        memory.importance,
        memory.userId || null,
        memory.sessionId || null,
        memory.embedding ? Buffer.from(new Float32Array(memory.embedding).buffer) : null,
        0,
        now,
        now
      ]
    )

    console.log(`[LongTermMemoryStore] Saved memory: ${id}`)
    return id
  }

  /**
   * 检索记忆
   */
  async retrieveMemories(query: MemoryQuery): Promise<LongTermMemoryEntry[]> {
    let sql = `SELECT * FROM long_term_memory WHERE 1=1`
    const params: unknown[] = []

    if (query.userId) {
      sql += ` AND user_id = ?`
      params.push(query.userId)
    }

    if (query.type) {
      sql += ` AND type = ?`
      params.push(query.type)
    }

    if (query.minImportance) {
      sql += ` AND importance >= ?`
      params.push(query.minImportance)
    }

    // 关键词搜索（简单实现，未来可用向量搜索）
    if (query.keywords && query.keywords.length > 0) {
      const keywordConditions = query.keywords.map(() => `content LIKE ?`).join(' OR ')
      sql += ` AND (${keywordConditions})`
      for (const keyword of query.keywords) {
        params.push(`%${keyword}%`)
      }
    }

    sql += ` ORDER BY importance DESC, created_at DESC`

    if (query.limit) {
      sql += ` LIMIT ?`
      params.push(query.limit)
    }

    const rows = (await this.db.query(sql, params)) as Record<string, unknown>[]
    return rows.map((row) => this.rowToEntry(row))
  }

  /**
   * 更新记忆的访问信息
   */
  async markAccessed(memoryId: string): Promise<void> {
    const now = Date.now()

    await this.db.execute(
      `UPDATE long_term_memory 
       SET access_count = access_count + 1, accessed_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, memoryId]
    )
  }

  /**
   * 更新记忆内容
   */
  async updateMemory(
    memoryId: string,
    updates: {
      content?: string
      importance?: number
      context?: string
    }
  ): Promise<boolean> {
    const sets: string[] = []
    const params: unknown[] = []

    if (updates.content !== undefined) {
      sets.push('content = ?')
      params.push(updates.content)
    }

    if (updates.importance !== undefined) {
      sets.push('importance = ?')
      params.push(updates.importance)
    }

    if (updates.context !== undefined) {
      sets.push('context = ?')
      params.push(updates.context)
    }

    if (sets.length === 0) {
      return false
    }

    sets.push('updated_at = ?')
    params.push(Date.now())

    params.push(memoryId)

    const changedRows = await this.db.execute(
      `UPDATE long_term_memory SET ${sets.join(', ')} WHERE id = ?`,
      params
    )

    return changedRows > 0
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    const changedRows = await this.db.execute(`DELETE FROM long_term_memory WHERE id = ?`, [
      memoryId
    ])

    return changedRows > 0
  }

  /**
   * 清理过期记忆
   */
  async cleanupOldMemories(daysToKeep: number = 90): Promise<number> {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

    // 只清理低重要性（<5）且过期的记忆
    const deletedCount = await this.db.execute(
      `DELETE FROM long_term_memory 
       WHERE created_at < ? AND importance < 5`,
      [cutoffTime]
    )

    console.log(`[LongTermMemoryStore] Cleaned up ${deletedCount} old memories`)

    return deletedCount
  }

  /**
   * 获取记忆统计
   */
  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    byImportance: Record<string, number>
    avgAccessCount: number
  }> {
    const rows = (await this.db.query(
      `SELECT 
         type, 
         importance, 
         COUNT(*) as count,
         AVG(access_count) as avg_access
       FROM long_term_memory 
       GROUP BY type, importance`
    )) as Array<Record<string, unknown>>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = (await this.db.queryOne(`SELECT COUNT(*) as total FROM long_term_memory`)) as any

    const byType: Record<string, number> = {}
    const byImportance: Record<string, number> = {}
    let totalAccess = 0
    let totalCount = 0

    for (const row of rows) {
      const type = row.type as string
      const importance = row.importance as number
      const count = row.count as number
      const avgAccess = row.avg_access as number

      byType[type] = (byType[type] || 0) + count
      byImportance[`${importance}`] = (byImportance[`${importance}`] || 0) + count

      totalAccess += avgAccess * count
      totalCount += count
    }

    return {
      total: (total?.total as number) || 0,
      byType,
      byImportance,
      avgAccessCount: totalCount > 0 ? totalAccess / totalCount : 0
    }
  }

  // ========== 私有方法 ==========

  /**
   * 将数据库行转换为记忆条目
   */
  private rowToEntry(row: Record<string, unknown>): LongTermMemoryEntry {
    return {
      id: row.id as string,
      type: row.type as LongTermMemoryType,
      content: row.content as string,
      context: (row.context as string) || undefined,
      importance: row.importance as number,
      userId: (row.user_id as string) || undefined,
      sessionId: (row.session_id as string) || undefined,
      accessCount: (row.access_count as number) || 0,
      createdAt: row.created_at as number,
      accessedAt: (row.accessed_at as number) || undefined
    }
  }
}
