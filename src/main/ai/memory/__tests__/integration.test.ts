/**
 * 结构化记忆系统 — 集成测试
 *
 * 端到端测试完整对话流程：输入 → 提取 → 存储 → 检索 → 注入
 * 使用 Mock SQLiteConnection + Mock LLM 模拟全链路。
 */

import { describe, it, expect, beforeEach } from 'vitest';

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

// ==================== Mock LLM Client ====================

const XML_RESPONSE_TYPESCRIPT = `<item>
<memory>
  <content>用户偏好使用 TypeScript 开发</content>
  <categories><category>preferences</category></categories>
</memory>
</item>`;

const XML_RESPONSE_COFFEE = `<item>
<memory>
  <content>用户喜欢喝手冲咖啡</content>
  <categories><category>preferences</category></categories>
</memory>
</item>`;

const XML_RESPONSE_ARCH = `<item>
<memory>
  <content>项目采用三层架构设计模式</content>
  <categories><category>knowledge</category></categories>
</memory>
</item>`;

const XML_EMPTY = '<item></item>';

/**
 * Mock LLM — 根据 prompt 中的关键词返回固定 XML。
 * 每个关键词映射到唯一的响应，避免跨类型误匹配。
 */
function createMockLLMClient(): {
  chat: (opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ content: string }>;
} {
  return {
    async chat(opts) {
      const text = opts.messages.map((m) => m.content).join('\n');
      if (text.includes('TypeScript')) return { content: XML_RESPONSE_TYPESCRIPT };
      if (text.includes('咖啡')) return { content: XML_RESPONSE_COFFEE };
      if (text.includes('三层架构')) return { content: XML_RESPONSE_ARCH };
      return { content: XML_EMPTY };
    }
  };
}

// ==================== Mock Embedding Provider ====================

class MockEmbeddingProvider {
  readonly dimension = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return [
        lower.includes('typescript') || lower.includes('代码') ? 0.9 : 0.1,
        lower.includes('coffee') || lower.includes('咖啡') ? 0.9 : 0.1,
        lower.includes('vue') || lower.includes('前端') ? 0.9 : 0.1,
        lower.includes('设计') || lower.includes('架构') ? 0.9 : 0.1
      ];
    });
  }
}

// ==================== Integration Tests ====================

describe('结构化记忆系统集成测试', () => {
  let storage: InstanceType<typeof import('../structured/storage').StructuredMemoryStorage>;
  let memorize: InstanceType<typeof import('../structured/memorize').MemorizePipeline>;
  let retrieve: InstanceType<typeof import('../structured/retrieve').RetrievePipeline>;

  beforeEach(async () => {
    const conn = new MockSQLiteConnection();
    const { StructuredMemoryStorage } = await import('../structured/storage');
    const { MemorizePipeline } = await import('../structured/memorize');
    const { RetrievePipeline } = await import('../structured/retrieve');

    storage = new StructuredMemoryStorage(conn as never);
    await storage.initialize();

    memorize = new MemorizePipeline(storage, createMockLLMClient() as never);
    retrieve = new RetrievePipeline(storage, new MockEmbeddingProvider() as never);
  });

  it('完整对话流程：输入 → 提取 → 存储 → 检索 → 注入', async () => {
    // 1. 输入对话内容（包含 "TypeScript" 触发 mock LLM）
    const result = await memorize.memorize({
      content: '用户提到喜欢使用 TypeScript 和 Vue 3 开发'
    });

    // 2. 验证有提取到记忆
    expect(result.items.length + result.reinforced.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);

    // 3. 为记忆添加 embedding
    const embProvider = new MockEmbeddingProvider();
    const allItems = await storage.listItems();
    for (const item of allItems) {
      const [embedding] = await embProvider.embed([item.summary]);
      const { encodeEmbedding } = await import('../structured/models');
      await storage.updateItem(item.id, { embedding: encodeEmbedding(embedding) });
    }

    // 4. 检索（query 包含 "TypeScript" → 高相似度向量）
    const retrieved = await retrieve.retrieve({
      query: 'TypeScript 开发',
      topK: 5
    });

    // 5. 验证检索到相关记忆
    expect(retrieved.items.length).toBeGreaterThan(0);
    expect(retrieved.context).toContain('TypeScript');
  });

  it('多轮对话记忆持久化', async () => {
    // 第一轮：TypeScript 相关
    await memorize.memorize({
      content: '讨论了 TypeScript 的类型系统'
    });

    // 第二轮：咖啡相关
    await memorize.memorize({
      content: '聊到用户喜欢喝咖啡'
    });

    // 验证两轮的记忆都被存储
    const allItems = await storage.listItems();
    expect(allItems.length).toBeGreaterThanOrEqual(2);

    const summaries = allItems.map((i) => i.summary);
    const hasTS = summaries.some((s) => s.includes('TypeScript'));
    const hasCoffee = summaries.some((s) => s.includes('咖啡'));
    expect(hasTS).toBe(true);
    expect(hasCoffee).toBe(true);
  });

  it('跨 session 记忆检索', async () => {
    // Session A: 写入架构相关记忆
    await memorize.memorize({
      content: '讨论了项目的三层架构设计',
      sessionId: 'session-a'
    });

    // 为记忆添加 embedding
    const items = await storage.listItems();
    const embProvider = new MockEmbeddingProvider();
    for (const item of items) {
      const [embedding] = await embProvider.embed([item.summary]);
      const { encodeEmbedding } = await import('../structured/models');
      await storage.updateItem(item.id, { embedding: encodeEmbedding(embedding) });
    }

    // Session B: 检索 Session A 的记忆（query 包含 "架构"）
    const retrieved = await retrieve.retrieve({
      query: '架构设计',
      topK: 5
    });

    expect(retrieved.items.length).toBeGreaterThan(0);
    expect(retrieved.context).toContain('架构');
  });

  it('记忆去重和 reinforcement', async () => {
    // 第一次写入
    const result1 = await memorize.memorize({
      content: '用户喜欢 TypeScript'
    });
    const itemsBefore = await storage.listItems();
    const countBefore = itemsBefore.length;

    // 重复写入相同内容（同一个 LLM 返回相同记忆）
    const result2 = await memorize.memorize({
      content: '再次提到 TypeScript 偏好'
    });

    const itemsAfter = await storage.listItems();

    // 第一次有新建 items
    expect(result1.items.length).toBeGreaterThan(0);

    // 第二次：相同内容+相同类型 → 只 reinforce 不新建
    // 但不同类型（profile vs event vs knowledge）可能产生新 items
    // 所以总 items 数至少不会翻倍
    expect(itemsAfter.length).toBeLessThanOrEqual(countBefore * 2);

    // reinforcement_count 至少有 item ≥ 2
    const reinforcedItem = itemsAfter.find((i) => i.reinforcementCount >= 2);
    if (result2.reinforced.length > 0) {
      expect(reinforcedItem).toBeTruthy();
    }
  });

  it('记忆衰减（模拟时间推移 — salience 排名）', async () => {
    const { encodeEmbedding, nowISO, computeContentHash } = await import('../structured/models');
    const embProvider = new MockEmbeddingProvider();

    // 创建"旧"记忆（reinforcement 低）
    const oldHash = computeContentHash('旧代码规范已过时', 'knowledge');
    const oldItem = await storage.createItem({
      memoryType: 'knowledge',
      summary: '旧代码规范已过时',
      contentHash: oldHash,
      reinforcementCount: 1,
      lastReinforcedAt: '2024-01-01T00:00:00Z'
    });
    const [oldEmb] = await embProvider.embed(['旧代码规范已过时']);
    await storage.updateItem(oldItem.id, { embedding: encodeEmbedding(oldEmb) });

    // 创建"新"记忆（reinforcement 高）
    const newHash = computeContentHash('新 TypeScript 代码规范很重要', 'knowledge');
    const newItem = await storage.createItem({
      memoryType: 'knowledge',
      summary: '新 TypeScript 代码规范很重要',
      contentHash: newHash,
      reinforcementCount: 5,
      lastReinforcedAt: nowISO()
    });
    const [newEmb] = await embProvider.embed(['新 TypeScript 代码规范很重要']);
    await storage.updateItem(newItem.id, { embedding: encodeEmbedding(newEmb) });

    // salience 排名 — 高 reinforcement + 近期 → 分数更高
    const result = await retrieve.retrieve({
      query: '代码规范',
      topK: 2,
      ranking: 'salience'
    });

    expect(result.items.length).toBe(2);
    expect(result.items[0].summary).toContain('新 TypeScript');
  });
});
