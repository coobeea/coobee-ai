/**
 * Memorize Pipeline — 单元测试
 *
 * 测试 LLM 提取 → 去重 → 持久化的完整流程。
 * LLM 调用用 mock 替代。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeContentHash,
  parseExtractionResponse,
  buildExtractionPrompt,
  formatCategoriesForPrompt,
  DEFAULT_CATEGORIES
} from '../structured';

// ==================== Mock Infrastructure ====================

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

// ==================== Mock LLM Client ====================

function createMockLLMClient(responses: Record<string, string> = {}): {
  chat: ReturnType<typeof vi.fn>;
} {
  return {
    chat: vi.fn(async ({ messages }) => {
      const userMsg = messages.find((m: { role: string }) => m.role === 'user')?.content || '';

      // Match response based on content
      for (const [key, response] of Object.entries(responses)) {
        if (userMsg.includes(key))
          return { content: response, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }

      return { content: '<item></item>', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    })
  };
}

// ==================== XML Parse Tests ====================

describe('XML 解析', () => {
  it('解析标准 XML 输出', () => {
    const xml = `
<item>
    <memory>
        <content>用户是 30 岁的产品经理</content>
        <categories>
            <category>personal_info</category>
        </categories>
    </memory>
    <memory>
        <content>用户在互联网公司工作</content>
        <categories>
            <category>work_life</category>
        </categories>
    </memory>
</item>`;
    const results = parseExtractionResponse(xml);
    expect(results.length).toBe(2);
    expect(results[0].content).toBe('用户是 30 岁的产品经理');
    expect(results[0].categories).toEqual(['personal_info']);
    expect(results[1].content).toBe('用户在互联网公司工作');
  });

  it('解析多分类', () => {
    const xml = `<item><memory>
        <content>用户周末和家人去公园</content>
        <categories>
            <category>activities</category>
            <category>relationships</category>
        </categories>
    </memory></item>`;
    const results = parseExtractionResponse(xml);
    expect(results.length).toBe(1);
    expect(results[0].categories).toEqual(['activities', 'relationships']);
  });

  it('空 item 返回空数组', () => {
    expect(parseExtractionResponse('<item></item>')).toEqual([]);
    expect(parseExtractionResponse('')).toEqual([]);
  });

  it('跳过空 content', () => {
    const xml = `<item><memory><content></content><categories></categories></memory></item>`;
    expect(parseExtractionResponse(xml)).toEqual([]);
  });

  it('容忍格式不规范的输出', () => {
    const xml = `Here is the extracted memory:
<item>
<memory>
<content>用户喜欢咖啡</content>
<categories><category>preferences</category></categories>
</memory>
</item>
Some extra text here.`;
    const results = parseExtractionResponse(xml);
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('用户喜欢咖啡');
  });
});

// ==================== Prompt 构建 Tests ====================

describe('Prompt 构建', () => {
  it('构建 profile prompt', () => {
    const prompt = buildExtractionPrompt('profile', '测试对话', '- personal_info: 基本信息');
    expect(prompt).toContain('长期稳定信息');
    expect(prompt).toContain('测试对话');
    expect(prompt).toContain('personal_info');
  });

  it('构建 event prompt', () => {
    const prompt = buildExtractionPrompt('event', '测试对话', '- activities: 活动');
    expect(prompt).toContain('具体事件和经历');
    expect(prompt).toContain('测试对话');
  });

  it('构建 knowledge prompt', () => {
    const prompt = buildExtractionPrompt('knowledge', '测试对话', '- knowledge: 知识');
    expect(prompt).toContain('事实知识');
  });

  it('不支持的类型返回 null', () => {
    const prompt = buildExtractionPrompt('behavior' as never, '测试', '分类');
    expect(prompt).toBeNull();
  });

  it('格式化分类列表', () => {
    const result = formatCategoriesForPrompt([
      { name: 'personal_info', description: '基本信息' },
      { name: 'preferences', description: '偏好' }
    ]);
    expect(result).toContain('personal_info: 基本信息');
    expect(result).toContain('preferences: 偏好');
  });
});

// ==================== Memorize Pipeline Tests ====================

describe('MemorizePipeline', () => {
  let storage: InstanceType<typeof import('../structured/storage').StructuredMemoryStorage>;
  let pipeline: InstanceType<typeof import('../structured/memorize').MemorizePipeline>;

  const profileXml = `<item>
    <memory>
      <content>用户是一名产品经理</content>
      <categories><category>personal_info</category></categories>
    </memory>
    <memory>
      <content>用户喜欢喝咖啡</content>
      <categories><category>preferences</category></categories>
    </memory>
  </item>`;

  const eventXml = `<item>
    <memory>
      <content>用户下周末计划去旅行</content>
      <categories><category>activities</category></categories>
    </memory>
  </item>`;

  const knowledgeXml = `<item></item>`;

  beforeEach(async () => {
    const conn = new MockSQLiteConnection();
    const { StructuredMemoryStorage } = await import('../structured/storage');
    const { MemorizePipeline } = await import('../structured/memorize');

    storage = new StructuredMemoryStorage(conn as never);
    await storage.initialize();

    const mockLLM = createMockLLMClient({
      长期稳定信息: profileXml,
      具体事件和经历: eventXml,
      事实知识: knowledgeXml
    });

    pipeline = new MemorizePipeline(storage, mockLLM as never);
  });

  afterEach(() => {
    storage.close();
  });

  it('提取 profile 和 event 记忆', async () => {
    const result = await pipeline.memorize({
      content: '我是一名产品经理，喜欢喝咖啡。下周末计划去旅行。',
      sessionId: 'test-session'
    });

    expect(result.errors.length).toBe(0);
    expect(result.items.length).toBe(3); // 2 profile + 1 event
    expect(result.resource).not.toBeNull();

    const types = result.items.map((i) => i.memoryType);
    expect(types).toContain('profile');
    expect(types).toContain('event');
  });

  it('去重：相同内容第二次 memorize 增加 reinforcement', async () => {
    const result1 = await pipeline.memorize({
      content: '我是一名产品经理，喜欢喝咖啡。下周末计划去旅行。',
      sessionId: 'session-1'
    });
    expect(result1.items.length).toBe(3);
    expect(result1.reinforced.length).toBe(0);

    const result2 = await pipeline.memorize({
      content: '我是一名产品经理，喜欢喝咖啡。下周末计划去旅行。',
      sessionId: 'session-2'
    });
    expect(result2.items.length).toBe(0); // 全部去重
    expect(result2.reinforced.length).toBe(3);
    expect(result2.reinforced[0].newCount).toBe(2);
  });

  it('空输出的 LLM 不产生记忆', async () => {
    const mockLLM = createMockLLMClient({});
    const { MemorizePipeline } = await import('../structured/memorize');
    const emptyPipeline = new MemorizePipeline(storage, mockLLM as never);

    const result = await emptyPipeline.memorize({
      content: '今天天气不错',
      sessionId: 'test'
    });

    expect(result.items.length).toBe(0);
  });

  it('默认分类自动创建', async () => {
    await pipeline.memorize({ content: 'test', sessionId: 'test' });

    const categories = await storage.listCategories();
    expect(categories.length).toBe(DEFAULT_CATEGORIES.length);
    expect(categories.map((c) => c.name)).toContain('personal_info');
    expect(categories.map((c) => c.name)).toContain('preferences');
  });

  it('分类关系正确创建', async () => {
    const result = await pipeline.memorize({
      content: '我是一名产品经理',
      sessionId: 'test'
    });

    for (const item of result.items) {
      const rels = await storage.listCategoriesByItem(item.id);
      expect(rels.length).toBeGreaterThan(0);
    }
  });

  it('LLM 调用失败时 errors 中包含错误信息', async () => {
    const failLLM = {
      chat: vi.fn().mockRejectedValue(new Error('API Error'))
    };
    const { MemorizePipeline } = await import('../structured/memorize');
    const failPipeline = new MemorizePipeline(storage, failLLM as never);

    const result = await failPipeline.memorize({
      content: 'test content',
      sessionId: 'test'
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Extraction failed');
  });
});

// ==================== Content Hash Dedup ====================

describe('去重 content_hash', () => {
  it('相同内容不同空白产生相同 hash', () => {
    const h1 = computeContentHash('用户喜欢 喝咖啡', 'profile');
    const h2 = computeContentHash('用户喜欢  喝咖啡', 'profile');
    expect(h1).toBe(h2);
  });

  it('不同 memoryType 产生不同 hash', () => {
    const h1 = computeContentHash('用户喜欢喝咖啡', 'profile');
    const h2 = computeContentHash('用户喜欢喝咖啡', 'knowledge');
    expect(h1).not.toBe(h2);
  });
});
