/**
 * 结构化记忆存储 — 单元测试
 *
 * 因为 better-sqlite3-multiple-ciphers 是 Electron 原生模块，
 * vitest 运行在普通 Node.js 环境下会报 NODE_MODULE_VERSION 不匹配。
 * 因此 SQLite 相关的测试用 mock SQLiteConnection 实现。
 *
 * 覆盖：CRUD、去重、过滤、分类关系、向量搜索、Salience 评分
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeContentHash,
  encodeEmbedding,
  decodeEmbedding,
  cosineSimilarity,
  salienceScore,
  cosineTopK,
  cosineTopKSalience
} from '../structured';

// ==================== Mock SQLiteConnection ====================

/**
 * 用内存存储模拟 SQLiteConnection 的行为。
 * 不依赖 better-sqlite3 原生模块。
 */
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

    if (trimmed.startsWith('INSERT')) {
      return this.handleInsert(sql, params || []);
    }

    if (trimmed.startsWith('UPDATE')) {
      return this.handleUpdate(sql, params || []);
    }

    if (trimmed.startsWith('DELETE')) {
      return this.handleDelete(sql, params || []);
    }

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
    rows = this.applyOrderBy(rows, sql);
    rows = this.applyLimit(rows, sql, params || []);

    if (sql.includes('GROUP BY')) {
      return this.handleGroupBy(rows, sql);
    }
    if (sql.includes('COUNT(*)')) {
      return [{ c: rows.length, count: rows.length }];
    }

    return rows;
  }

  async queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null> {
    const rows = await this.query(sql, params);
    return rows[0] ?? null;
  }

  close(): void {
    // no-op for mock
  }

  // ---------- INSERT ----------
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

  // ---------- UPDATE ----------
  private handleUpdate(sql: string, params: unknown[]): number {
    const tableName = this.getTableName(sql);
    this.ensureTable(tableName);

    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
    if (!setMatch) return 0;

    const setParts = setMatch[1].split(',').map((s) => s.trim());
    const whereMatch = sql.match(/WHERE\s+id\s*=\s*\?/i);
    if (!whereMatch) return 0;

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

  // ---------- DELETE ----------
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

  // ---------- WHERE helpers ----------
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

    return Object.entries(groups).map(([key, groupRows]) => ({
      [groupCol]: key,
      c: groupRows.length
    }));
  }
}

// ==================== Tests ====================

// 动态导入 StructuredMemoryStorage，用 mock 替代真实的 SQLiteConnection
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

// ==================== Resource CRUD ====================

describe('Resource CRUD', () => {
  it('创建和读取 resource', async () => {
    const res = await storage.createResource({
      url: 'test://conv1.json',
      modality: 'conversation',
      content: '对话内容'
    });
    expect(res.id).toBeTruthy();
    expect(res.url).toBe('test://conv1.json');
    expect(res.modality).toBe('conversation');

    const fetched = await storage.getResource(res.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.url).toBe('test://conv1.json');
  });

  it('列出所有 resources', async () => {
    await storage.createResource({ url: 'a.json', modality: 'conversation' });
    await storage.createResource({ url: 'b.json', modality: 'document' });
    const list = await storage.listResources();
    expect(list.length).toBe(2);
  });

  it('删除 resource', async () => {
    const res = await storage.createResource({ url: 'del.json', modality: 'text' });
    const deleted = await storage.deleteResource(res.id);
    expect(deleted).toBe(true);
    const fetched = await storage.getResource(res.id);
    expect(fetched).toBeNull();
  });

  it('不存在的 resource 返回 null', async () => {
    const fetched = await storage.getResource('nonexistent-id');
    expect(fetched).toBeNull();
  });
});

// ==================== MemoryItem CRUD ====================

describe('MemoryItem CRUD', () => {
  it('创建和读取 item', async () => {
    const hash = computeContentHash('用户喜欢喝咖啡', 'profile');
    const item = await storage.createItem({
      memoryType: 'profile',
      summary: '用户喜欢喝咖啡',
      contentHash: hash
    });
    expect(item.id).toBeTruthy();
    expect(item.memoryType).toBe('profile');
    expect(item.reinforcementCount).toBe(1);

    const fetched = await storage.getItem(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.summary).toBe('用户喜欢喝咖啡');
  });

  it('按 memoryType 过滤', async () => {
    const hash1 = computeContentHash('profile 1', 'profile');
    const hash2 = computeContentHash('event 1', 'event');
    const hash3 = computeContentHash('profile 2', 'profile');
    await storage.createItem({ memoryType: 'profile', summary: 'profile 1', contentHash: hash1 });
    await storage.createItem({ memoryType: 'event', summary: 'event 1', contentHash: hash2 });
    await storage.createItem({ memoryType: 'profile', summary: 'profile 2', contentHash: hash3 });

    const profiles = await storage.listItems({ memoryType: 'profile' });
    expect(profiles.length).toBe(2);

    const events = await storage.listItems({ memoryType: 'event' });
    expect(events.length).toBe(1);
  });

  it('limit 参数', async () => {
    for (let i = 0; i < 5; i++) {
      const hash = computeContentHash(`item ${i}`, 'knowledge');
      await storage.createItem({ memoryType: 'knowledge', summary: `item ${i}`, contentHash: hash });
    }
    const limited = await storage.listItems({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it('按 contentHash 查重', async () => {
    const hash = computeContentHash('用户是产品经理', 'profile');
    await storage.createItem({ memoryType: 'profile', summary: '用户是产品经理', contentHash: hash });

    const found = await storage.findItemByHash(hash);
    expect(found).not.toBeNull();
    expect(found!.summary).toBe('用户是产品经理');

    const notFound = await storage.findItemByHash('aaaa1111bbbb2222');
    expect(notFound).toBeNull();
  });

  it('更新 item', async () => {
    const hash = computeContentHash('test update', 'profile');
    const item = await storage.createItem({ memoryType: 'profile', summary: 'test update', contentHash: hash });

    const updated = await storage.updateItem(item.id, {
      summary: 'updated summary',
      reinforcementCount: 5
    });
    expect(updated).toBe(true);

    const fetched = await storage.getItem(item.id);
    expect(fetched!.summary).toBe('updated summary');
    expect(fetched!.reinforcementCount).toBe(5);
  });

  it('强化（reinforce）item', async () => {
    const hash = computeContentHash('reinforce test', 'profile');
    const item = await storage.createItem({ memoryType: 'profile', summary: 'reinforce test', contentHash: hash });

    await storage.reinforceItem(item.id);
    const fetched = await storage.getItem(item.id);
    expect(fetched!.reinforcementCount).toBe(2);

    await storage.reinforceItem(item.id);
    const fetched2 = await storage.getItem(item.id);
    expect(fetched2!.reinforcementCount).toBe(3);
  });

  it('删除 item', async () => {
    const hash = computeContentHash('to delete', 'event');
    const item = await storage.createItem({ memoryType: 'event', summary: 'to delete', contentHash: hash });
    const deleted = await storage.deleteItem(item.id);
    expect(deleted).toBe(true);
    const fetched = await storage.getItem(item.id);
    expect(fetched).toBeNull();
  });

  it('countItems', async () => {
    expect(await storage.countItems()).toBe(0);

    const h1 = computeContentHash('a', 'profile');
    const h2 = computeContentHash('b', 'event');
    await storage.createItem({ memoryType: 'profile', summary: 'a', contentHash: h1 });
    await storage.createItem({ memoryType: 'event', summary: 'b', contentHash: h2 });

    expect(await storage.countItems()).toBe(2);
    expect(await storage.countItems({ memoryType: 'profile' })).toBe(1);
  });

  it('embedding 存取', async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = encodeEmbedding(embedding);
    const hash = computeContentHash('with embedding', 'knowledge');
    const item = await storage.createItem({
      memoryType: 'knowledge',
      summary: 'with embedding',
      contentHash: hash,
      embedding: encoded
    });

    const fetched = await storage.getItem(item.id);
    const decoded = decodeEmbedding(fetched!.embedding);
    expect(decoded).toEqual(embedding);
  });
});

// ==================== MemoryCategory CRUD ====================

describe('MemoryCategory CRUD', () => {
  it('创建和读取 category', async () => {
    const cat = await storage.createCategory({
      name: 'personal_info',
      description: '基本信息'
    });
    expect(cat.id).toBeTruthy();
    expect(cat.name).toBe('personal_info');

    const fetched = await storage.getCategory(cat.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.description).toBe('基本信息');
  });

  it('按 name 查找 category', async () => {
    await storage.createCategory({ name: 'preferences', description: '偏好' });
    const found = await storage.getCategoryByName('preferences');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('preferences');

    const notFound = await storage.getCategoryByName('nonexistent');
    expect(notFound).toBeNull();
  });

  it('列出所有 categories', async () => {
    await storage.createCategory({ name: 'cat_a', description: 'A' });
    await storage.createCategory({ name: 'cat_b', description: 'B' });
    const list = await storage.listCategories();
    expect(list.length).toBe(2);
  });

  it('更新 category summary', async () => {
    const cat = await storage.createCategory({ name: 'test_cat', description: 'test' });
    await storage.updateCategory(cat.id, { summary: '更新后的摘要' });
    const fetched = await storage.getCategory(cat.id);
    expect(fetched!.summary).toBe('更新后的摘要');
  });

  it('删除 category', async () => {
    const cat = await storage.createCategory({ name: 'to_del', description: 'del' });
    const deleted = await storage.deleteCategory(cat.id);
    expect(deleted).toBe(true);
    const fetched = await storage.getCategory(cat.id);
    expect(fetched).toBeNull();
  });
});

// ==================== CategoryItem 关系 ====================

describe('CategoryItem 关系', () => {
  it('创建和查询关系', async () => {
    const cat = await storage.createCategory({ name: 'rel_test', description: 'test' });
    const hash = computeContentHash('rel item', 'profile');
    const item = await storage.createItem({ memoryType: 'profile', summary: 'rel item', contentHash: hash });

    const rel = await storage.createCategoryItem({ itemId: item.id, categoryId: cat.id });
    expect(rel.id).toBeTruthy();
    expect(rel.itemId).toBe(item.id);
    expect(rel.categoryId).toBe(cat.id);

    const byCategory = await storage.listItemsByCategory(cat.id);
    expect(byCategory.length).toBe(1);
    expect(byCategory[0].itemId).toBe(item.id);

    const byItem = await storage.listCategoriesByItem(item.id);
    expect(byItem.length).toBe(1);
    expect(byItem[0].categoryId).toBe(cat.id);
  });

  it('多对多关系', async () => {
    const cat1 = await storage.createCategory({ name: 'c1', description: '1' });
    const cat2 = await storage.createCategory({ name: 'c2', description: '2' });
    const hash = computeContentHash('multi cat item', 'event');
    const item = await storage.createItem({ memoryType: 'event', summary: 'multi cat item', contentHash: hash });

    await storage.createCategoryItem({ itemId: item.id, categoryId: cat1.id });
    await storage.createCategoryItem({ itemId: item.id, categoryId: cat2.id });

    const itemCats = await storage.listCategoriesByItem(item.id);
    expect(itemCats.length).toBe(2);
  });

  it('删除关系', async () => {
    const cat = await storage.createCategory({ name: 'del_rel', description: 'test' });
    const hash = computeContentHash('del rel item', 'profile');
    const item = await storage.createItem({ memoryType: 'profile', summary: 'del rel item', contentHash: hash });
    const rel = await storage.createCategoryItem({ itemId: item.id, categoryId: cat.id });

    const deleted = await storage.deleteCategoryItem(rel.id);
    expect(deleted).toBe(true);

    const remaining = await storage.listItemsByCategory(cat.id);
    expect(remaining.length).toBe(0);
  });

  it('删除 item 时级联删除关系', async () => {
    const cat = await storage.createCategory({ name: 'cascade_test', description: 'test' });
    const hash = computeContentHash('cascade item', 'profile');
    const item = await storage.createItem({ memoryType: 'profile', summary: 'cascade item', contentHash: hash });
    await storage.createCategoryItem({ itemId: item.id, categoryId: cat.id });

    await storage.deleteItem(item.id);

    const remaining = await storage.listItemsByCategory(cat.id);
    expect(remaining.length).toBe(0);
  });
});

// ==================== Stats ====================

describe('Stats', () => {
  it('返回正确的统计数据', async () => {
    const h1 = computeContentHash('p1', 'profile');
    const h2 = computeContentHash('e1', 'event');
    const h3 = computeContentHash('k1', 'knowledge');
    await storage.createItem({ memoryType: 'profile', summary: 'p1', contentHash: h1 });
    await storage.createItem({ memoryType: 'event', summary: 'e1', contentHash: h2 });
    await storage.createItem({ memoryType: 'knowledge', summary: 'k1', contentHash: h3 });
    await storage.createCategory({ name: 'stat_cat', description: 'test' });

    const stats = await storage.getStats();
    expect(stats.totalItems).toBe(3);
    expect(stats.totalCategories).toBe(1);
    expect(stats.byType['profile']).toBe(1);
    expect(stats.byType['event']).toBe(1);
    expect(stats.byType['knowledge']).toBe(1);
  });
});

// ==================== Content Hash 去重 ====================

describe('Content Hash', () => {
  it('相同内容+类型生成相同 hash', () => {
    const h1 = computeContentHash('用户喜欢喝咖啡', 'profile');
    const h2 = computeContentHash('用户喜欢喝咖啡', 'profile');
    expect(h1).toBe(h2);
  });

  it('规范化空白差异', () => {
    const h1 = computeContentHash('用户 喜欢  喝咖啡', 'profile');
    const h2 = computeContentHash('用户  喜欢 喝咖啡', 'profile');
    expect(h1).toBe(h2);
  });

  it('大小写不敏感', () => {
    const h1 = computeContentHash('User likes Coffee', 'profile');
    const h2 = computeContentHash('user likes coffee', 'profile');
    expect(h1).toBe(h2);
  });

  it('不同类型生成不同 hash', () => {
    const h1 = computeContentHash('same content', 'profile');
    const h2 = computeContentHash('same content', 'event');
    expect(h1).not.toBe(h2);
  });

  it('hash 长度为 16', () => {
    const h = computeContentHash('test', 'profile');
    expect(h.length).toBe(16);
  });
});

// ==================== Embedding 编解码 ====================

describe('Embedding 编解码', () => {
  it('编码和解码 embedding', () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = encodeEmbedding(vec);
    expect(typeof encoded).toBe('string');
    const decoded = decodeEmbedding(encoded);
    expect(decoded).toEqual(vec);
  });

  it('null 处理', () => {
    expect(encodeEmbedding(null)).toBeNull();
    expect(decodeEmbedding(null)).toBeNull();
  });

  it('无效 JSON 返回 null', () => {
    expect(decodeEmbedding('not json')).toBeNull();
  });
});

// ==================== 向量搜索 ====================

describe('向量搜索', () => {
  it('cosineSimilarity 正确计算', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('cosineTopK 返回正确排序', () => {
    const query = [1, 0, 0];
    const corpus = [
      { id: 'a', embedding: [1, 0, 0] },
      { id: 'b', embedding: [0, 1, 0] },
      { id: 'c', embedding: [0.7, 0.7, 0] }
    ];
    const results = cosineTopK(query, corpus, 2);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('c');
  });

  it('空 corpus 返回空数组', () => {
    expect(cosineTopK([1, 0], [], 5)).toEqual([]);
  });

  it('k 大于 corpus 时返回全部', () => {
    const corpus = [{ id: 'a', embedding: [1, 0] }];
    const results = cosineTopK([1, 0], corpus, 10);
    expect(results.length).toBe(1);
  });
});

// ==================== Salience 评分 ====================

describe('Salience 评分', () => {
  it('reinforcement=0 时 score=0（log(1)=0）', () => {
    const score = salienceScore(0.9, 0, new Date(), 30);
    expect(score).toBeCloseTo(0);
  });

  it('reinforcement 越高 score 越高', () => {
    const now = new Date();
    const s1 = salienceScore(0.8, 1, now, 30);
    const s5 = salienceScore(0.8, 5, now, 30);
    const s20 = salienceScore(0.8, 20, now, 30);
    expect(s5).toBeGreaterThan(s1);
    expect(s20).toBeGreaterThan(s5);
  });

  it('时间衰减：30 天前约为一半', () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400 * 1000);
    const recent = salienceScore(0.8, 5, now, 30);
    const old = salienceScore(0.8, 5, thirtyDaysAgo, 30);
    expect(old / recent).toBeCloseTo(0.5, 1);
  });

  it('lastReinforcedAt=null 时 recencyFactor=0.5', () => {
    const withNull = salienceScore(0.8, 5, null, 30);
    const withRecent = salienceScore(0.8, 5, new Date(), 30);
    expect(withNull).toBeLessThan(withRecent);
    expect(withNull / withRecent).toBeCloseTo(0.5, 1);
  });

  it('cosineTopKSalience 排名正确', () => {
    const query = [1, 0, 0];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400 * 1000);

    const corpus = [
      { id: 'frequent_recent', embedding: [0.7, 0.7, 0], reinforcementCount: 10, lastReinforcedAt: now },
      { id: 'similar_once', embedding: [1, 0, 0], reinforcementCount: 1, lastReinforcedAt: now },
      { id: 'frequent_old', embedding: [0.7, 0.7, 0], reinforcementCount: 10, lastReinforcedAt: thirtyDaysAgo }
    ];

    const results = cosineTopKSalience(query, corpus, 3, 30);
    expect(results.length).toBe(3);
    expect(results[0].id).toBe('frequent_recent');
  });
});

// ==================== listItemsWithEmbedding ====================

describe('listItemsWithEmbedding', () => {
  it('只返回有 embedding 的 items', async () => {
    const h1 = computeContentHash('with emb', 'profile');
    const h2 = computeContentHash('without emb', 'profile');
    await storage.createItem({
      memoryType: 'profile',
      summary: 'with emb',
      contentHash: h1,
      embedding: encodeEmbedding([0.1, 0.2, 0.3])
    });
    await storage.createItem({
      memoryType: 'profile',
      summary: 'without emb',
      contentHash: h2
    });

    const items = await storage.listItemsWithEmbedding();
    expect(items.length).toBe(1);
    expect(items[0].embedding).toBeTruthy();
  });
});
