/**
 * Knowledge Graph Types
 *
 * 知识图谱核心类型定义
 */

/**
 * 图节点类型
 */
export type NodeType = 'file' | 'function' | 'class' | 'concept' | 'person' | 'task' | 'agent';

/**
 * 图边类型（关系）
 */
export type EdgeType =
  | 'calls'
  | 'imports'
  | 'implements'
  | 'extends'
  | 'mentions'
  | 'depends-on'
  | 'authored-by'
  | 'executed-by'
  | 'related-to';

/**
 * 图节点
 */
export interface GraphNode {
  /** 节点唯一 ID */
  id: string;

  /** 节点类型 */
  type: NodeType;

  /** 节点标签（显示名称） */
  label: string;

  /** 节点属性（JSON） */
  properties: Record<string, unknown>;

  /** 创建时间戳 */
  createdAt: number;

  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * 图边（关系）
 */
export interface GraphEdge {
  /** 边唯一 ID */
  id: string;

  /** 起始节点 ID */
  from: string;

  /** 目标节点 ID */
  to: string;

  /** 边类型（关系类型） */
  type: EdgeType;

  /** 边权重（0-1，表示关系强度） */
  weight: number;

  /** 边属性（JSON） */
  properties?: Record<string, unknown>;

  /** 创建时间戳 */
  createdAt: number;
}

/**
 * 图查询结果
 */
export interface QueryResult {
  /** 匹配的节点 */
  nodes: GraphNode[];

  /** 匹配的边 */
  edges: GraphEdge[];

  /** 查询元数据 */
  metadata?: {
    executionTime?: number;
    totalResults?: number;
  };
}

/**
 * 图查询条件
 */
export interface QueryOptions {
  /** 节点类型过滤 */
  nodeTypes?: NodeType[];

  /** 边类型过滤 */
  edgeTypes?: EdgeType[];

  /** 属性过滤（key-value 匹配） */
  properties?: Record<string, unknown>;

  /** 最大返回结果数 */
  limit?: number;

  /** 跳过前 N 个结果 */
  offset?: number;

  /** 是否包含边（默认 true） */
  includeEdges?: boolean;
}

/**
 * 路径查询结果
 */
export interface PathResult {
  /** 路径上的节点 ID 序列 */
  path: string[];

  /** 路径长度 */
  length: number;

  /** 路径权重（所有边权重之和） */
  weight: number;
}
