/**
 * KnowledgeGraph - 知识图谱核心类
 *
 * 提供高层 API 来操作知识图谱
 */

import { createLogger } from '@main/common/logger';
import { GraphStore } from './storage/GraphStore';
import type { GraphNode, GraphEdge, QueryOptions, QueryResult, PathResult } from './types';

const log = createLogger('knowledge-graph');

export class KnowledgeGraph {
  private store!: GraphStore;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static async create(): Promise<KnowledgeGraph> {
    const graph = new KnowledgeGraph();
    graph.store = await GraphStore.getInstance();
    return graph;
  }

  /**
   * 添加节点
   */
  addNode(node: Omit<GraphNode, 'createdAt' | 'updatedAt'>): GraphNode {
    const now = Date.now();
    const fullNode: GraphNode = {
      ...node,
      createdAt: now,
      updatedAt: now
    };

    this.store.upsertNode(fullNode);
    log.debug(`[KnowledgeGraph] Node added: ${node.id} (${node.type})`);
    return fullNode;
  }

  /**
   * 添加关系
   */
  addEdge(edge: Omit<GraphEdge, 'id' | 'createdAt'>): GraphEdge {
    const id = `${edge.from}→${edge.to}:${edge.type}`;
    const fullEdge: GraphEdge = {
      ...edge,
      id,
      createdAt: Date.now()
    };

    this.store.addEdge(fullEdge);
    log.debug(`[KnowledgeGraph] Edge added: ${edge.from} -[${edge.type}]-> ${edge.to}`);
    return fullEdge;
  }

  /**
   * 获取节点
   */
  getNode(id: string): GraphNode | null {
    return this.store.getNode(id);
  }

  /**
   * 查询节点
   */
  query(options: QueryOptions): QueryResult {
    return this.store.queryNodes(options);
  }

  /**
   * 获取邻居节点
   */
  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    return this.store.getNeighbors(nodeId, edgeType);
  }

  /**
   * 查找最短路径（BFS）
   */
  findPath(fromId: string, toId: string, maxDepth = 5): PathResult | null {
    const queue: { nodeId: string; path: string[]; weight: number }[] = [
      { nodeId: fromId, path: [fromId], weight: 0 }
    ];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === toId) {
        return {
          path: current.path,
          length: current.path.length - 1,
          weight: current.weight
        };
      }

      if (current.path.length >= maxDepth + 1) {
        continue;
      }

      const neighbors = this.getNeighbors(current.nodeId);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          queue.push({
            nodeId: neighbor.id,
            path: [...current.path, neighbor.id],
            weight: current.weight + 1
          });
        }
      }
    }

    return null;
  }

  /**
   * 删除节点
   */
  deleteNode(id: string): void {
    this.store.deleteNode(id);
    log.info(`[KnowledgeGraph] Node deleted: ${id}`);
  }

  /**
   * 清空图谱
   */
  clear(): void {
    this.store.clear();
    log.info('[KnowledgeGraph] Graph cleared');
  }

  /**
   * 获取统计信息
   */
  getStats(): { nodeCount: number; edgeCount: number; nodesByType: Record<string, number> } {
    return this.store.getStats();
  }
}
