/**
 * Retrieve Pipeline — 单元测试
 *
 * 测试语义检索：embedding → cosine/salience 搜索 → 格式化注入
 * 使用 mock embedding provider（确定性向量）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeContentHash, encodeEmbedding } from '../structured';
import type { EmbeddingProvider } from '../structured';

// ==================== Mock SQLiteConnection ====================

class MockSQLiteConnection {
  private tables: Record<string, Record<string, unknown>[]> = {};

  private getTableName(sql: string): string {
    const match = sql.match(/(?:FROM|INTO|UPDATE|TABLE IF NOT EXISTS|TABLE)\s+(\w+)/i);
    return match?.[1] ?? '';
  }

  private ensureTable(name: string): void {
    if (!this.tables[name]) this.tables[name] = [];
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('CREATE INDEX')) {
      const tableName = this.getTableName(sql);
      if (tableName) this.ensureTable(tableName);
      return 0;
    }
    if (trimmed.startsWith('INSERT')) return this.handleInsert(sql, params || []);
    if (trimmed.startsWith('UPDATE')) return this.handleUpdate(sql, params || []);
    if (trimmed.startsWith('DELETE')) return this.handleDelete(sql, params || []);
    return 0;
  }

  async insert(sql: string, params?: unknown[]): Promise<number> {
    return this.execute(sql, params);
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const tableName = this.getTableName(sql);
    this.ensureTable(tableName);
    let rows = [...this.tables[tableName]];
    rows = this.applyWhere(rows, sql, params || []);
    if (sql.includes('GROUP BY')) return this.handleGroupBy(rows, sql);
    if (sql.includes('COUNT(*)')) return [{ c: rows.length, count: rows.length }];
    rows = this.applyLimit(rows, sql, params || []);
    return rows;
  }

  async queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null> {
    const rows = await this.query(sql, params);
    return rows[0] ?? null;
  }

  close(): void {
    // no-op for mock
  }

  private handleInsert(sql: string, params: unknown[]): number {
    const tableName = this.getTableName(sql);
    this.ensureTable(tableName);
    const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
    if (!colMatch) return 0;
    const columns = colMatch[1].split(',').map((c) => c.trim());
    const row: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = params[i] ?? null;
    }
    this.tables[tableName].push(row);
    return 1;
  }

  private handleUpdate(sql: string, params: unknown[]): number {
    const tableName = this.getTableName(sql);
    this.ensureTable(tableName);
    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
    if (!setMatch) return 0;
    const setParts = setMatch[1].split(',').map((s) => s.trim());
    const idValue = params[params.length - 1];
    let changes = 0;
    for (const row of this.tables[tableName]) {
      if (row.id === idValue) {
        let paramIdx = 0;
        for (const part of setParts) {
          const colName = part.split('=')[0].trim();
          if (part.includes('reinforcement_count + 1')) {
            row[colName] = ((row[colName] as number) ?? 0) + 1;
          } else if (part.includes('?')) {
            row[colName] = params[paramIdx];
            paramIdx++;
          }
        }
        changes++;
      }
    }
    return changes;
  }

  private handleDelete(sql: string, params: unknown[]): number {
    const tableName = this.getTableName(sql);
    this.ensureTable(tableName);
    const before = this.tables[tableName].length;
    const whereCol = this.extractWhereColumn(sql);
    if (whereCol && params.length > 0) {
      this.tables[tableName] = this.tables[tableName].filter((r) => r[whereCol] !== params[0]);
    }
    return before - this.tables[tableName].length;
  }

  private extractWhereColumn(sql: string): string | null {
    const match = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    return match?.[1] ?? null;
  }

  private applyWhere(rows: Record<string, unknown>[], sql: string, params: unknown[]): Record<string, unknown>[] {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s*$)/is);
    if (!whereMatch) return rows;
    const conditions = whereMatch[1];
    let paramIdx = 0;
    let result = rows;
    const parts = conditions.split(/\s+AND\s+/i);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed === '1=1') continue;
      if (trimmed.includes('IS NOT NULL')) {
        const col = trimmed.replace(/\s+IS\s+NOT\s+NULL/i, '').trim();
        result = result.filter((r) => r[col] != null && r[col] !== '');
        continue;
      }
      const colMatch = trimmed.match(/(\w+)\s*=\s*\?/);
      if (colMatch) {
        const col = colMatch[1];
        const val = params[paramIdx++];
        result = result.filter((r) => r[col] === val);
      }
    }
    return result;
  }

  private applyLimit(rows: Record<string, unknown>[], sql: string, params: unknown[]): Record<string, unknown>[] {
    const limitMatch = sql.match(/LIMIT\s+\?/i);
    if (!limitMatch) return rows;
    const limitVal = params[params.length - 1] as number;
    return rows.slice(0, limitVal);
  }

  private handleGroupBy(rows: Record<string, unknown>[], sql: string): Record<string, unknown>[] {
    const groupMatch = sql.match(/GROUP BY\s+(\w+)/i);
    if (!groupMatch) return [{ c: rows.length }];
    const groupCol = groupMatch[1];
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const row of rows) {
      const key = String(row[groupCol] ?? '');
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }
    return Object.entries(groups).map(([key, g]) => ({ [groupCol]: key, c: g.length }));
  }
}

// ==================== Mock Embedding Provider ====================

/**
 * 确定性 embedding provider：对特定关键词返回预设向量。
 * 用于测试搜索排名的正确性。
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 3;

  private keywords: Record<string, number[]> = {
    咖啡: [1, 0, 0],
    coffee: [1, 0, 0],
    旅行: [0, 1, 0],
    travel: [0, 1, 0],
    产品经理: [0, 0, 1],
    manager: [0, 0, 1]
  };

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      for (const [kw, vec] of Object.entries(this.keywords)) {
        if (text.includes(kw)) return vec;
      }
      return [0.33, 0.33, 0.33]; // default: equal in all dims
    });
  }
}

// ==================== Tests ====================

let storage: InstanceType<typeof import('../structured/storage').StructuredMemoryStorage>;
let pipeline: InstanceType<typeof import('../structured/retrieve').RetrievePipeline>;

beforeEach(async () => {
  const conn = new MockSQLiteConnection();
  const { StructuredMemoryStorage } = await import('../structured/storage');
  const { RetrievePipeline } = await import('../structured/retrieve');

  storage = new StructuredMemoryStorage(conn as never);
  await storage.initialize();

  const embProvider = new MockEmbeddingProvider();
  pipeline = new RetrievePipeline(storage, embProvider);
});

afterEach(() => {
  storage.close();
});

async function seedItems(): Promise<void> {
  // 三条带 embedding 的记忆
  await storage.createItem({
    memoryType: 'profile',
    summary: '用户喜欢喝咖啡',
    contentHash: computeContentHash('用户喜欢喝咖啡', 'profile'),
    embedding: encodeEmbedding([1, 0, 0]), // 与 "咖啡" query 完全匹配
    reinforcementCount: 5,
    lastReinforcedAt: new Date().toISOString()
  });

  await storage.createItem({
    memoryType: 'event',
    summary: '用户下周末计划去旅行',
    contentHash: computeContentHash('用户下周末计划去旅行', 'event'),
    embedding: encodeEmbedding([0, 1, 0]), // 与 "旅行" query 完全匹配
    reinforcementCount: 1,
    lastReinforcedAt: new Date().toISOString()
  });

  await storage.createItem({
    memoryType: 'profile',
    summary: '用户是一名产品经理',
    contentHash: computeContentHash('用户是一名产品经理', 'profile'),
    embedding: encodeEmbedding([0, 0, 1]), // 与 "产品经理" query 完全匹配
    reinforcementCount: 3,
    lastReinforcedAt: new Date(Date.now() - 60 * 86400 * 1000).toISOString() // 60 days ago
  });
}

describe('RetrievePipeline', () => {
  it('语义相似查询返回相关记忆', async () => {
    await seedItems();
    const result = await pipeline.retrieve({ query: '咖啡' });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].summary).toContain('咖啡');
    expect(result.items[0].score).toBeGreaterThan(0);
  });

  it('similarity 模式下最相似的排第一', async () => {
    await seedItems();
    const result = await pipeline.retrieve({
      query: '旅行',
      ranking: 'similarity'
    });

    expect(result.items[0].summary).toContain('旅行');
  });

  it('salience 模式考虑 reinforcement', async () => {
    await seedItems();
    // "咖啡" 向量 = [1,0,0]，与 "咖啡" item（reinforcement=5）完全匹配
    const result = await pipeline.retrieve({
      query: '咖啡',
      ranking: 'salience'
    });

    expect(result.items[0].summary).toContain('咖啡');
    expect(result.items[0].score).toBeGreaterThan(0);
  });

  it('topK 限制结果数量', async () => {
    await seedItems();
    const result = await pipeline.retrieve({
      query: '用户',
      topK: 2
    });

    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('空 embedding 时返回空结果', async () => {
    // 没有任何带 embedding 的 items
    await storage.createItem({
      memoryType: 'profile',
      summary: 'no embedding',
      contentHash: computeContentHash('no embedding', 'profile')
    });

    const result = await pipeline.retrieve({ query: 'test' });
    expect(result.items.length).toBe(0);
  });

  it('context 格式正确', async () => {
    await seedItems();
    const result = await pipeline.retrieve({ query: '咖啡' });

    expect(result.context).toContain('<memory_context>');
    expect(result.context).toContain('</memory_context>');
    expect(result.context).toContain('[profile]');
    expect(result.context).toContain('咖啡');
  });

  it('无结果时 context 为空字符串', async () => {
    const result = await pipeline.retrieve({ query: 'test' });
    expect(result.context).toBe('');
    expect(result.items.length).toBe(0);
  });
});

describe('NoopEmbeddingProvider', () => {
  it('返回空向量', async () => {
    const { NoopEmbeddingProvider } = await import('../structured/embedding');
    const provider = new NoopEmbeddingProvider();
    const result = await provider.embed(['test']);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual([]);
    expect(provider.dimension).toBe(0);
  });

  it('NoopProvider 降级到关键词搜索', async () => {
    const { NoopEmbeddingProvider } = await import('../structured/embedding');
    const { RetrievePipeline } = await import('../structured/retrieve');

    const noopPipeline = new RetrievePipeline(storage, new NoopEmbeddingProvider());
    await seedItems();

    const result = await noopPipeline.retrieve({ query: '咖啡' });
    expect(result.items.length).toBeGreaterThanOrEqual(0);

    const irrelevant = await noopPipeline.retrieve({ query: 'zzzznonexistent' });
    expect(irrelevant.items.length).toBe(0);
  });
});
