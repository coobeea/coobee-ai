/**
 * Agent Designer Types
 *
 * 可视化设计器类型定义
 */

/**
 * 设计器节点类型
 */
export type NodeType = 'agent' | 'tool' | 'skill' | 'workflow' | 'condition' | 'action';

/**
 * 设计器节点
 */
export interface DesignerNode {
  /** 节点 ID */
  id: string;

  /** 节点类型 */
  type: NodeType;

  /** 标签 */
  label: string;

  /** 位置 */
  position: {
    x: number;
    y: number;
  };

  /** 配置数据 */
  data: Record<string, unknown>;
}

/**
 * 设计器连接
 */
export interface DesignerEdge {
  /** 连接 ID */
  id: string;

  /** 源节点 */
  source: string;

  /** 目标节点 */
  target: string;

  /** 连接类型 */
  type: 'flow' | 'data' | 'dependency';

  /** 标签 */
  label?: string;
}

/**
 * 工作流模板
 */
export interface WorkflowTemplate {
  /** 模板 ID */
  id: string;

  /** 模板名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 节点 */
  nodes: DesignerNode[];

  /** 连接 */
  edges: DesignerEdge[];

  /** 标签 */
  tags: string[];

  /** 创建时间 */
  createdAt: number;
}

/**
 * 设计器配置
 */
export interface DesignerConfig {
  /** 网格大小 */
  gridSize: number;

  /** 是否显示网格 */
  showGrid: boolean;

  /** 是否自动保存 */
  autoSave: boolean;

  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
}
