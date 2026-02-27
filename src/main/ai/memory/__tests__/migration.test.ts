/**
 * Migration — 单元测试
 *
 * 测试 Markdown → SQLite 迁移和 SQLite → Markdown 导出
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeContentHash } from '../structured';

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

// ==================== Tests ====================

let tmpDir: string;
let storage: InstanceType<typeof import('../structured/storage').StructuredMemoryStorage>;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
  const conn = new MockSQLiteConnection();
  const { StructuredMemoryStorage } = await import('../structured/storage');
  storage = new StructuredMemoryStorage(conn as never);
  await storage.initialize();
});

afterEach(() => {
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrateFromMarkdown', () => {
  it('迁移 MEMORY.md 中的列表项', async () => {
    const workDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'MEMORY.md'),
      `# Core Memory

- 用户喜欢使用 TypeScript
- 项目使用 Tailwind CSS 4
- 代码风格偏好简洁
`,
      'utf-8'
    );

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(3);
    expect(result.errors.length).toBe(0);
    expect(result.files).toContain('MEMORY.md');
  });

  it('迁移 memory-auto 格式的条目', async () => {
    const workDir = path.join(tmpDir, 'workspace2');
    fs.mkdirSync(path.join(workDir, 'memory'), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'memory', '2025-01-15.md'),
      `# Memory — 2025-01-15

- [14:30:22] (preference) 用户偏好使用 Vue 3 Composition API
- [14:35:10] (lesson) 发现 CJK word boundary \\b 不适用于中文
- [15:00:00] (summary) 完成了记忆系统的基础架构设计
`,
      'utf-8'
    );

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(3);
    expect(result.files).toContain('memory/2025-01-15.md');

    const items = await storage.listItems();
    expect(items.length).toBe(3);

    const types = items.map((i) => i.memoryType);
    expect(types).toContain('profile'); // preference → profile
    expect(types).toContain('knowledge'); // lesson → knowledge
  });

  it('重复迁移时去重（幂等）', async () => {
    const workDir = path.join(tmpDir, 'workspace3');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'MEMORY.md'), '- 用户喜欢喝咖啡\n', 'utf-8');

    const { migrateFromMarkdown } = await import('../structured/migration');

    const result1 = await migrateFromMarkdown(workDir, storage);
    expect(result1.migratedCount).toBe(1);
    expect(result1.duplicateCount).toBe(0);

    const result2 = await migrateFromMarkdown(workDir, storage);
    expect(result2.migratedCount).toBe(0);
    expect(result2.duplicateCount).toBe(1);

    const items = await storage.listItems();
    expect(items.length).toBe(1);
  });

  it('空文件不产生条目', async () => {
    const workDir = path.join(tmpDir, 'workspace4');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'MEMORY.md'), '', 'utf-8');

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(0);
  });

  it('无记忆文件时返回空结果', async () => {
    const workDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(workDir, { recursive: true });

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(0);
    expect(result.files.length).toBe(0);
  });

  it('原始文件未被修改', async () => {
    const workDir = path.join(tmpDir, 'workspace5');
    fs.mkdirSync(workDir, { recursive: true });
    const content = '- 重要记忆\n';
    fs.writeFileSync(path.join(workDir, 'MEMORY.md'), content, 'utf-8');

    const { migrateFromMarkdown } = await import('../structured/migration');
    await migrateFromMarkdown(workDir, storage);

    const afterContent = fs.readFileSync(path.join(workDir, 'MEMORY.md'), 'utf-8');
    expect(afterContent).toBe(content);
  });

  it('dryRun 模式不写入数据', async () => {
    const workDir = path.join(tmpDir, 'workspace6');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'MEMORY.md'), '- 这是一条用于测试 dryRun 的记忆条目\n', 'utf-8');

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage, { dryRun: true });

    expect(result.migratedCount).toBe(1);
    const items = await storage.listItems();
    expect(items.length).toBe(0);
  });

  it('含 frontmatter 的文件正确解析', async () => {
    const workDir = path.join(tmpDir, 'workspace7');
    fs.mkdirSync(path.join(workDir, 'memory'), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'memory', 'preferences.md'),
      `---
updated: 2025-01-15T10:00:00Z
---

- 用户喜欢深色主题
- 用户习惯使用 Vim 键位
`,
      'utf-8'
    );

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(2);
  });

  it('段落文本也被提取', async () => {
    const workDir = path.join(tmpDir, 'workspace8');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'MEMORY.md'),
      `这是一段关于用户偏好的重要记录。用户在日常开发中主要使用 TypeScript 和 Vue 3。

另一个独立段落描述了项目架构的设计决策和选型过程。
`,
      'utf-8'
    );

    const { migrateFromMarkdown } = await import('../structured/migration');
    const result = await migrateFromMarkdown(workDir, storage);

    expect(result.migratedCount).toBe(2);
  });
});

describe('exportToMarkdown', () => {
  it('按分类导出记忆', async () => {
    const cat = await storage.createCategory({
      name: 'preferences',
      description: '偏好'
    });
    const hash = computeContentHash('用户喜欢咖啡', 'profile');
    const item = await storage.createItem({
      memoryType: 'profile',
      summary: '用户喜欢咖啡',
      contentHash: hash
    });
    await storage.createCategoryItem({ itemId: item.id, categoryId: cat.id });

    const outputDir = path.join(tmpDir, 'export');
    const { exportToMarkdown } = await import('../structured/migration');
    const files = await exportToMarkdown(storage, outputDir);

    expect(files).toContain('preferences.md');
    const content = fs.readFileSync(path.join(outputDir, 'preferences.md'), 'utf-8');
    expect(content).toContain('用户喜欢咖啡');
    expect(content).toContain('[profile]');
  });

  it('未分类的 items 导出到 _uncategorized.md', async () => {
    const hash = computeContentHash('无分类记忆', 'knowledge');
    await storage.createItem({
      memoryType: 'knowledge',
      summary: '无分类记忆',
      contentHash: hash
    });

    const outputDir = path.join(tmpDir, 'export2');
    const { exportToMarkdown } = await import('../structured/migration');
    const files = await exportToMarkdown(storage, outputDir);

    expect(files).toContain('_uncategorized.md');
    const content = fs.readFileSync(path.join(outputDir, '_uncategorized.md'), 'utf-8');
    expect(content).toContain('无分类记忆');
  });
});
