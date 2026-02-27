/**
 * 结构化记忆系统 — 性能基准测试
 *
 * 验证向量搜索和存储操作在各种数据规模下满足性能要求。
 * 使用 Mock SQLiteConnection 和随机数据生成。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeContentHash, encodeEmbedding, nowISO, type MemoryType } from '../structured/models';
import { cosineTopK, cosineTopKSalience } from '../structured/vector';

// ==================== 工具函数 ====================

function randomEmbedding(dim: number): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

function randomMemoryType(): MemoryType {
  const types: MemoryType[] = ['profile', 'event', 'knowledge'];
  return types[Math.floor(Math.random() * types.length)];
}

function randomSummary(index: number): string {
  const topics = [
    '用户偏好使用 TypeScript',
    '项目采用 Vue 3 框架',
    'Tailwind CSS 4 是样式方案',
    '代码审查应该关注性能',
    '数据库选型使用 SQLite',
    'Electron 应用打包配置',
    'CI/CD 使用 GitHub Actions',
    '记忆系统使用向量检索',
    '安全审计每月执行一次',
    '团队会议每周三下午'
  ];
  return `${topics[index % topics.length]} (item-${index})`;
}

/** 简单计时器 */
function startTimer(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

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
    rows = this.applyOrderBy(rows, sql);
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

  private applyOrderBy(rows: Record<string, unknown>[], sql: string): Record<string, unknown>[] {
    const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (!orderMatch) return rows;
    const col = orderMatch[1];
    const desc = orderMatch[2]?.toUpperCase() === 'DESC';
    return rows.sort((a, b) => {
      const va = (a[col] ?? '') as string;
      const vb = (b[col] ?? '') as string;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return desc ? -cmp : cmp;
    });
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

// ==================== 辅助：批量写入 ====================

let storage: InstanceType<typeof import('../structured/storage').StructuredMemoryStorage>;

beforeEach(async () => {
  const conn = new MockSQLiteConnection();
  const { StructuredMemoryStorage } = await import('../structured/storage');
  storage = new StructuredMemoryStorage(conn as never);
  await storage.initialize();
});

afterEach(() => {
  storage.close();
});

async function seedItems(count: number, dim: number): Promise<Array<{ id: string; embedding: number[] }>> {
  const result: Array<{ id: string; embedding: number[] }> = [];
  for (let i = 0; i < count; i++) {
    const summary = randomSummary(i);
    const memoryType = randomMemoryType();
    const hash = computeContentHash(summary, memoryType);
    const embedding = randomEmbedding(dim);

    const item = await storage.createItem({
      memoryType,
      summary,
      contentHash: hash,
      embedding: encodeEmbedding(embedding),
      reinforcementCount: Math.floor(Math.random() * 10) + 1,
      lastReinforcedAt: nowISO()
    });

    result.push({ id: item.id, embedding });
  }
  return result;
}

// ==================== 性能基准 ====================

describe('向量搜索性能基准', () => {
  const DIM = 1536; // text-embedding-3-small 维度

  it('100 条记忆 cosineTopK < 50ms', async () => {
    const items = await seedItems(100, DIM);
    const queryVec = randomEmbedding(DIM);
    const corpus = items.map((i) => ({ id: i.id, embedding: i.embedding }));

    const elapsed = startTimer();
    const result = cosineTopK(queryVec, corpus, 10);
    const ms = elapsed();

    expect(result.length).toBe(10);
    expect(ms).toBeLessThan(50);
  });

  it('1000 条记忆 cosineTopK < 100ms', async () => {
    const items = await seedItems(1000, DIM);
    const queryVec = randomEmbedding(DIM);
    const corpus = items.map((i) => ({ id: i.id, embedding: i.embedding }));

    const elapsed = startTimer();
    const result = cosineTopK(queryVec, corpus, 10);
    const ms = elapsed();

    expect(result.length).toBe(10);
    expect(ms).toBeLessThan(100);
  });

  it('10000 条记忆 cosineTopK < 500ms', async () => {
    const items = await seedItems(10000, DIM);
    const queryVec = randomEmbedding(DIM);
    const corpus = items.map((i) => ({ id: i.id, embedding: i.embedding }));

    const elapsed = startTimer();
    const result = cosineTopK(queryVec, corpus, 10);
    const ms = elapsed();

    expect(result.length).toBe(10);
    expect(ms).toBeLessThan(500);
  });

  it('10000 条记忆 cosineTopKSalience < 600ms', async () => {
    const items = await seedItems(10000, DIM);
    const queryVec = randomEmbedding(DIM);
    const corpus = items.map((i) => ({
      id: i.id,
      embedding: i.embedding,
      reinforcementCount: Math.floor(Math.random() * 10) + 1,
      lastReinforcedAt: new Date(Date.now() - Math.random() * 86400000 * 365)
    }));

    const elapsed = startTimer();
    const result = cosineTopKSalience(queryVec, corpus, 10);
    const ms = elapsed();

    expect(result.length).toBe(10);
    expect(ms).toBeLessThan(600);
  });
});

describe('存储操作性能基准', () => {
  it('单次记忆写入 < 10ms（不含 LLM/embedding）', async () => {
    const summary = '性能测试记忆条目';
    const hash = computeContentHash(summary, 'knowledge');

    const elapsed = startTimer();
    await storage.createItem({
      memoryType: 'knowledge',
      summary,
      contentHash: hash,
      reinforcementCount: 1,
      lastReinforcedAt: nowISO()
    });
    const ms = elapsed();

    expect(ms).toBeLessThan(10);
  });

  it('批量写入 100 条 < 200ms', async () => {
    const elapsed = startTimer();
    for (let i = 0; i < 100; i++) {
      const summary = `批量测试记忆 ${i}`;
      const hash = computeContentHash(summary, 'knowledge');
      await storage.createItem({
        memoryType: 'knowledge',
        summary,
        contentHash: hash,
        reinforcementCount: 1,
        lastReinforcedAt: nowISO()
      });
    }
    const ms = elapsed();

    expect(ms).toBeLessThan(200);
  });

  it('统计查询 < 20ms', async () => {
    await seedItems(100, 4); // 小维度，仅测试 storage 性能

    const elapsed = startTimer();
    const stats = await storage.getStats();
    const ms = elapsed();

    expect(stats.totalItems).toBe(100);
    expect(ms).toBeLessThan(20);
  });
});
