/**
 * LongTermMemoryStore 测试
 *
 * 测试长期记忆存储的核心功能：
 * - 初始化（创建 Schema）
 * - 保存记忆
 * - 检索记忆（按用户、类型、重要性、关键词过滤）
 * - 标记访问
 * - 更新记忆
 * - 删除记忆
 * - 清理过期记忆
 * - 获取统计信息
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Mock fs =====
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('file not found'))
}))

// ===== Mock SnowflakeIdGenerator =====
let idCounter = 0
vi.mock('@main/utils', () => ({
  generateSnowflakeId: vi.fn(() => `snowflake-${++idCounter}`)
}))

// ===== Mock database =====
const mockExecute = vi.fn().mockResolvedValue(0)
const mockQuery = vi.fn().mockResolvedValue([])
const mockQueryOne = vi.fn().mockResolvedValue(null)

const mockDb = {
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne
}

import { LongTermMemoryStore } from '../LongTermMemoryStore'
import { LongTermMemoryType } from '../types'

describe('LongTermMemoryStore', () => {
  let store: LongTermMemoryStore

  beforeEach(() => {
    vi.clearAllMocks()
    idCounter = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new LongTermMemoryStore(mockDb as any)
  })

  // ===== 初始化 =====

  describe('initialize', () => {
    it('创建 Schema', async () => {
      await store.initialize()

      // readFile 失败后走 inline 创建
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS long_term_memory')
      )
    })

    it('重复初始化不产生副作用', async () => {
      await store.initialize()
      const callCount = mockExecute.mock.calls.length

      await store.initialize()
      expect(mockExecute.mock.calls.length).toBe(callCount)
    })
  })

  // ===== 保存记忆 =====

  describe('saveMemory', () => {
    it('保存基本记忆条目', async () => {
      const id = await store.saveMemory({
        type: LongTermMemoryType.SEMANTIC,
        content: 'TypeScript is a superset of JavaScript',
        importance: 7
      })

      expect(id).toBe('snowflake-1')
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO long_term_memory'),
        expect.arrayContaining([
          'snowflake-1',
          LongTermMemoryType.SEMANTIC,
          'TypeScript is a superset of JavaScript',
          null, // context
          7, // importance
          null, // userId
          null // sessionId
        ])
      )
    })

    it('保存带完整属性的记忆条目', async () => {
      const id = await store.saveMemory({
        type: LongTermMemoryType.PREFERENCE,
        content: 'User prefers dark mode',
        context: 'UI preference',
        importance: 8,
        userId: 'user-1',
        sessionId: 'session-1',
        embedding: [0.1, 0.2, 0.3]
      })

      expect(id).toBe('snowflake-1')
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO long_term_memory'),
        expect.arrayContaining([
          'snowflake-1',
          LongTermMemoryType.PREFERENCE,
          'User prefers dark mode',
          'UI preference',
          8,
          'user-1',
          'session-1'
        ])
      )
    })
  })

  // ===== 检索记忆 =====

  describe('retrieveMemories', () => {
    it('无过滤条件检索', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'm1',
          type: 'semantic',
          content: 'fact 1',
          context: null,
          importance: 7,
          user_id: null,
          session_id: null,
          access_count: 2,
          created_at: 1000,
          accessed_at: 2000
        }
      ])

      const results = await store.retrieveMemories({})

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('m1')
      expect(results[0].type).toBe('semantic')
      expect(results[0].accessCount).toBe(2)
    })

    it('按用户过滤', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({ userId: 'user-1' })

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('user_id = ?'), ['user-1'])
    })

    it('按类型过滤', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({ type: LongTermMemoryType.EPISODIC })

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('type = ?'), [
        LongTermMemoryType.EPISODIC
      ])
    })

    it('按最低重要性过滤', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({ minImportance: 5 })

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('importance >= ?'), [5])
    })

    it('按关键词过滤', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({ keywords: ['TypeScript', 'Vue'] })

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('content LIKE ?'), [
        '%TypeScript%',
        '%Vue%'
      ])
    })

    it('带 limit', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({ limit: 10 })

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT ?'), [10])
    })

    it('组合过滤条件', async () => {
      mockQuery.mockResolvedValueOnce([])

      await store.retrieveMemories({
        userId: 'u1',
        type: LongTermMemoryType.LESSON,
        minImportance: 3,
        keywords: ['error'],
        limit: 5
      })

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toContain('user_id = ?')
      expect(sql).toContain('type = ?')
      expect(sql).toContain('importance >= ?')
      expect(sql).toContain('content LIKE ?')
      expect(sql).toContain('LIMIT ?')
      expect(mockQuery.mock.calls[0][1]).toEqual(['u1', LongTermMemoryType.LESSON, 3, '%error%', 5])
    })
  })

  // ===== 标记访问 =====

  describe('markAccessed', () => {
    it('更新访问计数和时间', async () => {
      await store.markAccessed('m1')

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('access_count = access_count + 1'),
        expect.arrayContaining(['m1'])
      )
    })
  })

  // ===== 更新记忆 =====

  describe('updateMemory', () => {
    it('更新内容', async () => {
      mockExecute.mockResolvedValueOnce(1)

      const result = await store.updateMemory('m1', { content: 'updated content' })

      expect(result).toBe(true)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('content = ?'),
        expect.arrayContaining(['updated content', 'm1'])
      )
    })

    it('更新重要性', async () => {
      mockExecute.mockResolvedValueOnce(1)

      const result = await store.updateMemory('m1', { importance: 9 })

      expect(result).toBe(true)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('importance = ?'),
        expect.arrayContaining([9, 'm1'])
      )
    })

    it('无更新字段返回 false', async () => {
      const result = await store.updateMemory('m1', {})

      expect(result).toBe(false)
    })

    it('记录不存在返回 false', async () => {
      mockExecute.mockResolvedValueOnce(0)

      const result = await store.updateMemory('nope', { content: 'x' })

      expect(result).toBe(false)
    })
  })

  // ===== 删除记忆 =====

  describe('deleteMemory', () => {
    it('删除成功返回 true', async () => {
      mockExecute.mockResolvedValueOnce(1)

      const result = await store.deleteMemory('m1')

      expect(result).toBe(true)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM long_term_memory WHERE id = ?'),
        ['m1']
      )
    })

    it('记录不存在返回 false', async () => {
      mockExecute.mockResolvedValueOnce(0)

      const result = await store.deleteMemory('nope')

      expect(result).toBe(false)
    })
  })

  // ===== 清理过期记忆 =====

  describe('cleanupOldMemories', () => {
    it('清理低重要性过期记忆', async () => {
      mockExecute.mockResolvedValueOnce(5)

      const count = await store.cleanupOldMemories(30)

      expect(count).toBe(5)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('importance < 5'),
        expect.any(Array)
      )
    })

    it('默认保留 90 天', async () => {
      mockExecute.mockResolvedValueOnce(0)

      await store.cleanupOldMemories()

      expect(mockExecute).toHaveBeenCalled()
    })
  })

  // ===== 统计 =====

  describe('getStats', () => {
    it('返回统计信息', async () => {
      mockQuery.mockResolvedValueOnce([
        { type: 'semantic', importance: 7, count: 10, avg_access: 2.5 },
        { type: 'episodic', importance: 5, count: 3, avg_access: 1.0 }
      ])
      mockQueryOne.mockResolvedValueOnce({ total: 13 })

      const stats = await store.getStats()

      expect(stats.total).toBe(13)
      expect(stats.byType['semantic']).toBe(10)
      expect(stats.byType['episodic']).toBe(3)
      expect(stats.byImportance['7']).toBe(10)
      expect(stats.byImportance['5']).toBe(3)
      expect(stats.avgAccessCount).toBeCloseTo((2.5 * 10 + 1.0 * 3) / 13)
    })

    it('空数据返回默认值', async () => {
      mockQuery.mockResolvedValueOnce([])
      mockQueryOne.mockResolvedValueOnce({ total: 0 })

      const stats = await store.getStats()

      expect(stats.total).toBe(0)
      expect(stats.avgAccessCount).toBe(0)
    })
  })
})
