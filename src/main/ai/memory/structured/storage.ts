/**
 * 结构化记忆系统 — SQLite 存储 + Repository
 *
 * 复用项目已有的 SQLiteConnection（better-sqlite3-multiple-ciphers），
 * 实现四个 Repository：Resource / MemoryItem / MemoryCategory / CategoryItem。
 */

import type { SQLiteConnection } from '@main/common/database';
import type {
  StructuredMemoryItem,
  StructuredMemoryCategory,
  StructuredCategoryItem,
  MemoryResource,
  MemoryType
} from './models';
import { generateId, nowISO } from './models';

// ==================== Schema ====================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sm_resources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  modality TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sm_items (
  id TEXT PRIMARY KEY,
  resource_id TEXT,
  memory_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding TEXT,
  happened_at TEXT,
  content_hash TEXT NOT NULL,
  reinforcement_count INTEGER DEFAULT 1,
  last_reinforced_at TEXT,
  extra TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES sm_resources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sm_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  summary TEXT,
  embedding TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sm_category_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES sm_items(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES sm_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sm_items_type ON sm_items(memory_type);
CREATE INDEX IF NOT EXISTS idx_sm_items_hash ON sm_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_sm_items_resource ON sm_items(resource_id);
CREATE INDEX IF NOT EXISTS idx_sm_catitems_item ON sm_category_items(item_id);
CREATE INDEX IF NOT EXISTS idx_sm_catitems_cat ON sm_category_items(category_id);
`;

// ==================== StructuredMemoryStorage ====================

export class StructuredMemoryStorage {
  private initialized = false;

  constructor(private db: SQLiteConnection) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const statements = SCHEMA_SQL.split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await this.db.execute(stmt);
    }
    this.initialized = true;
  }

  // ==================== Resource Repository ====================

  async createResource(data: { url: string; modality: string; content?: string }): Promise<MemoryResource> {
    const now = nowISO();
    const resource: MemoryResource = {
      id: generateId(),
      url: data.url,
      modality: data.modality,
      content: data.content || '',
      createdAt: now,
      updatedAt: now
    };
    await this.db.execute(
      `INSERT INTO sm_resources (id, url, modality, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [resource.id, resource.url, resource.modality, resource.content, resource.createdAt, resource.updatedAt]
    );
    return resource;
  }

  async getResource(id: string): Promise<MemoryResource | null> {
    const row = await this.db.queryOne('SELECT * FROM sm_resources WHERE id = ?', [id]);
    return row ? this.toResource(row) : null;
  }

  async listResources(): Promise<MemoryResource[]> {
    const rows = await this.db.query('SELECT * FROM sm_resources ORDER BY created_at DESC');
    return rows.map((r) => this.toResource(r));
  }

  async deleteResource(id: string): Promise<boolean> {
    const changes = await this.db.execute('DELETE FROM sm_resources WHERE id = ?', [id]);
    return changes > 0;
  }

  // ==================== MemoryItem Repository ====================

  async createItem(data: {
    resourceId?: string | null;
    memoryType: MemoryType;
    summary: string;
    embedding?: string | null;
    happenedAt?: string | null;
    contentHash: string;
    reinforcementCount?: number;
    lastReinforcedAt?: string | null;
    extra?: string;
  }): Promise<StructuredMemoryItem> {
    const now = nowISO();
    const item: StructuredMemoryItem = {
      id: generateId(),
      resourceId: data.resourceId ?? null,
      memoryType: data.memoryType,
      summary: data.summary,
      embedding: data.embedding ?? null,
      happenedAt: data.happenedAt ?? null,
      contentHash: data.contentHash,
      reinforcementCount: data.reinforcementCount ?? 1,
      lastReinforcedAt: data.lastReinforcedAt ?? now,
      extra: data.extra ?? '{}',
      createdAt: now,
      updatedAt: now
    };
    await this.db.execute(
      `INSERT INTO sm_items (id, resource_id, memory_type, summary, embedding, happened_at, content_hash, reinforcement_count, last_reinforced_at, extra, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.resourceId,
        item.memoryType,
        item.summary,
        item.embedding,
        item.happenedAt,
        item.contentHash,
        item.reinforcementCount,
        item.lastReinforcedAt,
        item.extra,
        item.createdAt,
        item.updatedAt
      ]
    );
    return item;
  }

  async getItem(id: string): Promise<StructuredMemoryItem | null> {
    const row = await this.db.queryOne('SELECT * FROM sm_items WHERE id = ?', [id]);
    return row ? this.toItem(row) : null;
  }

  async listItems(filter?: { memoryType?: MemoryType; limit?: number }): Promise<StructuredMemoryItem[]> {
    let sql = 'SELECT * FROM sm_items';
    const params: unknown[] = [];

    if (filter?.memoryType) {
      sql += ' WHERE memory_type = ?';
      params.push(filter.memoryType);
    }

    sql += ' ORDER BY created_at DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = await this.db.query(sql, params);
    return rows.map((r) => this.toItem(r));
  }

  async findItemByHash(contentHash: string): Promise<StructuredMemoryItem | null> {
    const row = await this.db.queryOne('SELECT * FROM sm_items WHERE content_hash = ?', [contentHash]);
    return row ? this.toItem(row) : null;
  }

  async updateItem(
    id: string,
    updates: Partial<
      Pick<StructuredMemoryItem, 'summary' | 'embedding' | 'reinforcementCount' | 'lastReinforcedAt' | 'extra'>
    >
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.summary !== undefined) {
      sets.push('summary = ?');
      params.push(updates.summary);
    }
    if (updates.embedding !== undefined) {
      sets.push('embedding = ?');
      params.push(updates.embedding);
    }
    if (updates.reinforcementCount !== undefined) {
      sets.push('reinforcement_count = ?');
      params.push(updates.reinforcementCount);
    }
    if (updates.lastReinforcedAt !== undefined) {
      sets.push('last_reinforced_at = ?');
      params.push(updates.lastReinforcedAt);
    }
    if (updates.extra !== undefined) {
      sets.push('extra = ?');
      params.push(updates.extra);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    params.push(nowISO());
    params.push(id);

    const changes = await this.db.execute(`UPDATE sm_items SET ${sets.join(', ')} WHERE id = ?`, params);
    return changes > 0;
  }

  async reinforceItem(id: string): Promise<boolean> {
    const now = nowISO();
    const changes = await this.db.execute(
      `UPDATE sm_items SET reinforcement_count = reinforcement_count + 1, last_reinforced_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id]
    );
    return changes > 0;
  }

  async deleteItem(id: string): Promise<boolean> {
    await this.db.execute('DELETE FROM sm_category_items WHERE item_id = ?', [id]);
    const changes = await this.db.execute('DELETE FROM sm_items WHERE id = ?', [id]);
    return changes > 0;
  }

  async countItems(filter?: { memoryType?: MemoryType }): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM sm_items';
    const params: unknown[] = [];
    if (filter?.memoryType) {
      sql += ' WHERE memory_type = ?';
      params.push(filter.memoryType);
    }
    const row = (await this.db.queryOne(sql, params)) as { count: number } | null;
    return row?.count ?? 0;
  }

  /**
   * 获取所有带 embedding 的 item（用于向量搜索）
   */
  async listItemsWithEmbedding(filter?: {
    memoryType?: MemoryType;
  }): Promise<Array<{ id: string; embedding: string; reinforcementCount: number; lastReinforcedAt: string | null }>> {
    let sql = 'SELECT id, embedding, reinforcement_count, last_reinforced_at FROM sm_items WHERE embedding IS NOT NULL';
    const params: unknown[] = [];
    if (filter?.memoryType) {
      sql += ' AND memory_type = ?';
      params.push(filter.memoryType);
    }
    const rows = await this.db.query(sql, params);
    return rows.map((r) => ({
      id: r.id as string,
      embedding: r.embedding as string,
      reinforcementCount: (r.reinforcement_count as number) ?? 1,
      lastReinforcedAt: (r.last_reinforced_at as string) ?? null
    }));
  }

  // ==================== MemoryCategory Repository ====================

  async createCategory(data: {
    name: string;
    description: string;
    summary?: string;
    embedding?: string | null;
  }): Promise<StructuredMemoryCategory> {
    const now = nowISO();
    const category: StructuredMemoryCategory = {
      id: generateId(),
      name: data.name,
      description: data.description,
      summary: data.summary ?? null,
      embedding: data.embedding ?? null,
      createdAt: now,
      updatedAt: now
    };
    await this.db.execute(
      `INSERT INTO sm_categories (id, name, description, summary, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        category.id,
        category.name,
        category.description,
        category.summary,
        category.embedding,
        category.createdAt,
        category.updatedAt
      ]
    );
    return category;
  }

  async getCategory(id: string): Promise<StructuredMemoryCategory | null> {
    const row = await this.db.queryOne('SELECT * FROM sm_categories WHERE id = ?', [id]);
    return row ? this.toCategory(row) : null;
  }

  async getCategoryByName(name: string): Promise<StructuredMemoryCategory | null> {
    const row = await this.db.queryOne('SELECT * FROM sm_categories WHERE name = ?', [name]);
    return row ? this.toCategory(row) : null;
  }

  async listCategories(): Promise<StructuredMemoryCategory[]> {
    const rows = await this.db.query('SELECT * FROM sm_categories ORDER BY name');
    return rows.map((r) => this.toCategory(r));
  }

  async updateCategory(
    id: string,
    updates: Partial<Pick<StructuredMemoryCategory, 'summary' | 'embedding' | 'description'>>
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.summary !== undefined) {
      sets.push('summary = ?');
      params.push(updates.summary);
    }
    if (updates.embedding !== undefined) {
      sets.push('embedding = ?');
      params.push(updates.embedding);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    params.push(nowISO());
    params.push(id);

    const changes = await this.db.execute(`UPDATE sm_categories SET ${sets.join(', ')} WHERE id = ?`, params);
    return changes > 0;
  }

  async deleteCategory(id: string): Promise<boolean> {
    await this.db.execute('DELETE FROM sm_category_items WHERE category_id = ?', [id]);
    const changes = await this.db.execute('DELETE FROM sm_categories WHERE id = ?', [id]);
    return changes > 0;
  }

  // ==================== CategoryItem Repository ====================

  async createCategoryItem(data: { itemId: string; categoryId: string }): Promise<StructuredCategoryItem> {
    const now = nowISO();
    const rel: StructuredCategoryItem = {
      id: generateId(),
      itemId: data.itemId,
      categoryId: data.categoryId,
      createdAt: now,
      updatedAt: now
    };
    await this.db.execute(
      `INSERT INTO sm_category_items (id, item_id, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [rel.id, rel.itemId, rel.categoryId, rel.createdAt, rel.updatedAt]
    );
    return rel;
  }

  async listCategoryItems(): Promise<StructuredCategoryItem[]> {
    const rows = await this.db.query('SELECT * FROM sm_category_items');
    return rows.map((r) => this.toCategoryItem(r));
  }

  async listItemsByCategory(categoryId: string): Promise<StructuredCategoryItem[]> {
    const rows = await this.db.query('SELECT * FROM sm_category_items WHERE category_id = ?', [categoryId]);
    return rows.map((r) => this.toCategoryItem(r));
  }

  async listCategoriesByItem(itemId: string): Promise<StructuredCategoryItem[]> {
    const rows = await this.db.query('SELECT * FROM sm_category_items WHERE item_id = ?', [itemId]);
    return rows.map((r) => this.toCategoryItem(r));
  }

  async deleteCategoryItem(id: string): Promise<boolean> {
    const changes = await this.db.execute('DELETE FROM sm_category_items WHERE id = ?', [id]);
    return changes > 0;
  }

  // ==================== Stats ====================

  async getStats(): Promise<{
    totalItems: number;
    totalCategories: number;
    totalResources: number;
    byType: Record<string, number>;
  }> {
    const itemCount = (await this.db.queryOne('SELECT COUNT(*) as c FROM sm_items')) as { c: number } | null;
    const catCount = (await this.db.queryOne('SELECT COUNT(*) as c FROM sm_categories')) as { c: number } | null;
    const resCount = (await this.db.queryOne('SELECT COUNT(*) as c FROM sm_resources')) as { c: number } | null;
    const typeRows = (await this.db.query(
      'SELECT memory_type, COUNT(*) as c FROM sm_items GROUP BY memory_type'
    )) as Array<{ memory_type: string; c: number }>;

    const byType: Record<string, number> = {};
    for (const r of typeRows) {
      byType[r.memory_type] = r.c;
    }

    return {
      totalItems: itemCount?.c ?? 0,
      totalCategories: catCount?.c ?? 0,
      totalResources: resCount?.c ?? 0,
      byType
    };
  }

  close(): void {
    this.db.close();
  }

  // ==================== Row Mappers ====================

  private toResource(row: Record<string, unknown>): MemoryResource {
    return {
      id: row.id as string,
      url: row.url as string,
      modality: row.modality as string,
      content: (row.content as string) ?? '',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  private toItem(row: Record<string, unknown>): StructuredMemoryItem {
    return {
      id: row.id as string,
      resourceId: (row.resource_id as string) ?? null,
      memoryType: row.memory_type as MemoryType,
      summary: row.summary as string,
      embedding: (row.embedding as string) ?? null,
      happenedAt: (row.happened_at as string) ?? null,
      contentHash: row.content_hash as string,
      reinforcementCount: (row.reinforcement_count as number) ?? 1,
      lastReinforcedAt: (row.last_reinforced_at as string) ?? null,
      extra: (row.extra as string) ?? '{}',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  private toCategory(row: Record<string, unknown>): StructuredMemoryCategory {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      summary: (row.summary as string) ?? null,
      embedding: (row.embedding as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  private toCategoryItem(row: Record<string, unknown>): StructuredCategoryItem {
    return {
      id: row.id as string,
      itemId: row.item_id as string,
      categoryId: row.category_id as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }
}
