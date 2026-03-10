/**
 * LanceDB 存储层
 *
 * 提供全局长期记忆的向量存储和检索能力
 */

import * as lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import type { MemoryEntry, RecallResult } from '../types/models';

const TABLE_NAME = 'memories';

export class LanceDBStorage {
  private db: Connection | null = null;
  private table: Table | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库连接和表
   */
  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await lancedb.connect(this.dbPath);

    // 检查表是否存在
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      // 创建空表（第一次使用时）
      // LanceDB 需要至少一条数据来推断 schema
      const schema: MemoryEntry = {
        id: 'init',
        text: 'Initialization entry',
        vector: new Array(1536).fill(0),
        importance: 1,
        category: 'other',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      };

      this.table = await this.db.createTable(TABLE_NAME, [schema]);
      // 删除初始化条目
      await this.table.delete('id = "init"');
    }
  }

  /**
   * 添加记忆条目
   */
  async add(entry: MemoryEntry): Promise<void> {
    if (!this.table) throw new Error('LanceDB not initialized');
    await this.table.add([entry]);
  }

  /**
   * 批量添加记忆条目
   */
  async addBatch(entries: MemoryEntry[]): Promise<void> {
    if (!this.table) throw new Error('LanceDB not initialized');
    if (entries.length === 0) return;
    await this.table.add(entries);
  }

  /**
   * 向量相似度检索
   *
   * @param queryVector 查询向量
   * @param topK 返回 Top-K 结果
   * @param minScore 最低相似度分数（0-1）
   */
  async search(queryVector: number[], topK: number = 5, minScore: number = 0.7): Promise<RecallResult[]> {
    if (!this.table) throw new Error('LanceDB not initialized');

    const results = await this.table.search(queryVector).limit(topK).toArray();

    // LanceDB 返回的是距离（越小越相似），需要转换为分数
    // 使用 L2 距离转相似度：score = 1 / (1 + distance)
    const recalled: RecallResult[] = results
      .map((r) => {
        const distance = r._distance as number;
        const score = 1 / (1 + distance);
        return {
          entry: r as unknown as MemoryEntry,
          score,
          distance
        };
      })
      .filter((r) => r.score >= minScore);

    // 更新访问统计
    for (const result of recalled) {
      await this.updateAccessStats(result.entry.id);
    }

    return recalled;
  }

  /**
   * 更新记忆的访问统计
   */
  private async updateAccessStats(id: string): Promise<void> {
    if (!this.table) return;

    try {
      // LanceDB 不支持原地更新，需要先读取再删除再添加
      const rows = await this.table.query().where(`id = "${id}"`).toArray();
      if (rows.length === 0) return;

      const entry = rows[0] as unknown as MemoryEntry;
      entry.lastAccessedAt = Date.now();
      entry.accessCount = (entry.accessCount || 0) + 1;

      await this.table.delete(`id = "${id}"`);
      await this.table.add([entry]);
    } catch (err) {
      // 静默失败，不影响主流程
      console.warn(`[LanceDB] Failed to update access stats for ${id}:`, err);
    }
  }

  /**
   * 获取所有记忆条目
   */
  async listAll(): Promise<MemoryEntry[]> {
    if (!this.table) throw new Error('LanceDB not initialized');
    const rows = await this.table.query().toArray();
    return rows as unknown as MemoryEntry[];
  }

  /**
   * 按分类获取记忆
   */
  async listByCategory(category: string): Promise<MemoryEntry[]> {
    if (!this.table) throw new Error('LanceDB not initialized');
    const rows = await this.table.query().where(`category = "${category}"`).toArray();
    return rows as unknown as MemoryEntry[];
  }

  /**
   * 删除记忆条目
   */
  async delete(id: string): Promise<void> {
    if (!this.table) throw new Error('LanceDB not initialized');
    await this.table.delete(`id = "${id}"`);
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{ total: number; byCategory: Record<string, number> }> {
    if (!this.table) throw new Error('LanceDB not initialized');

    const all = await this.listAll();
    const byCategory: Record<string, number> = {};

    for (const entry of all) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    }

    return {
      total: all.length,
      byCategory
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    // LanceDB Connection 没有显式 close 方法，由 GC 自动处理
    this.db = null;
    this.table = null;
  }
}
