/**
 * GraphStore - 知识图谱存储（基于 SQLite）
 *
 * 提供图节点和边的 CRUD 操作
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { GraphNode, GraphEdge, QueryOptions, QueryResult } from '../types';

const log = createLogger('graph-store');

export class GraphStore {
  private static instance: GraphStore | null = null;
  private db!: Database.Database;
  private dbPath!: string;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static async getInstance(): Promise<GraphStore> {
    if (!GraphStore.instance) {
      const { Env } = await import('@main/common/env');
      const store = new GraphStore();
      store.dbPath = path.join(Env.paths.userHome, 'knowledge', 'graph.db');
      await store.initialize();
      GraphStore.instance = store;
    }
    return GraphStore.instance;
  }

  static resetInstance(): void {
    if (GraphStore.instance?.db) {
      GraphStore.instance.db.close();
    }
    GraphStore.instance = null;
  }

  private async initialize(): Promise<void> {
    const fs = await import('node:fs');
    const dir = path.dirname(this.dbPath);
    await fs.promises.mkdir(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.createTables();
    log.info(`[GraphStore] Initialized at ${this.dbPath}`);
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        properties TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_node) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
    `);
  }

  /**
   * 添加或更新节点
   */
  upsertNode(node: GraphNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (id, type, label, properties, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        label = excluded.label,
        properties = excluded.properties,
        updated_at = excluded.updated_at
    `);

    stmt.run(node.id, node.type, node.label, JSON.stringify(node.properties), node.createdAt, node.updatedAt);
  }

  /**
   * 添加边
   */
  addEdge(edge: GraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT INTO edges (id, from_node, to_node, type, weight, properties, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    stmt.run(
      edge.id,
      edge.from,
      edge.to,
      edge.type,
      edge.weight,
      JSON.stringify(edge.properties || {}),
      edge.createdAt
    );
  }

  /**
   * 获取节点
   */
  getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    const row = stmt.get(id) as
      | { id: string; type: string; label: string; properties: string; created_at: number; updated_at: number }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type as GraphNode['type'],
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * 查询节点
   */
  queryNodes(options: QueryOptions): QueryResult {
    const { nodeTypes, properties, limit = 100, offset = 0, includeEdges = false } = options;

    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: unknown[] = [];

    if (nodeTypes && nodeTypes.length > 0) {
      sql += ` AND type IN (${nodeTypes.map(() => '?').join(',')})`;
      params.push(...nodeTypes);
    }

    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        sql += ` AND json_extract(properties, '$.${key}') = ?`;
        params.push(value);
      }
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      type: string;
      label: string;
      properties: string;
      created_at: number;
      updated_at: number;
    }>;

    const nodes: GraphNode[] = rows.map((row) => ({
      id: row.id,
      type: row.type as GraphNode['type'],
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    let edges: GraphEdge[] = [];

    if (includeEdges && nodes.length > 0) {
      const nodeIds = nodes.map((n) => n.id);
      const edgeSql = `SELECT * FROM edges WHERE from_node IN (${nodeIds.map(() => '?').join(',')}) OR to_node IN (${nodeIds.map(() => '?').join(',')})`;
      const edgeStmt = this.db.prepare(edgeSql);
      const edgeRows = edgeStmt.all(...nodeIds, ...nodeIds) as Array<{
        id: string;
        from_node: string;
        to_node: string;
        type: string;
        weight: number;
        properties: string;
        created_at: number;
      }>;

      edges = edgeRows.map((row) => ({
        id: row.id,
        from: row.from_node,
        to: row.to_node,
        type: row.type as GraphEdge['type'],
        weight: row.weight,
        properties: JSON.parse(row.properties),
        createdAt: row.created_at
      }));
    }

    return { nodes, edges };
  }

  /**
   * 获取节点的邻居（出边）
   */
  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    let sql = `
      SELECT n.* FROM nodes n
      INNER JOIN edges e ON n.id = e.to_node
      WHERE e.from_node = ?
    `;
    const params: unknown[] = [nodeId];

    if (edgeType) {
      sql += ' AND e.type = ?';
      params.push(edgeType);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      type: string;
      label: string;
      properties: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as GraphNode['type'],
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * 删除节点（级联删除关联的边）
   */
  deleteNode(id: string): void {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  }

  /**
   * 清空图谱
   */
  clear(): void {
    this.db.exec('DELETE FROM nodes; DELETE FROM edges;');
    log.info('[GraphStore] Graph cleared');
  }

  /**
   * 获取统计信息
   */
  getStats(): { nodeCount: number; edgeCount: number; nodesByType: Record<string, number> } {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }).count;

    const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type').all() as Array<{
      type: string;
      count: number;
    }>;

    const nodesByType: Record<string, number> = {};
    for (const row of typeRows) {
      nodesByType[row.type] = row.count;
    }

    return { nodeCount, edgeCount, nodesByType };
  }
}
