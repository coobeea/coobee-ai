/**
 * Memory Types
 *
 * 长期记忆类型定义
 */

/**
 * 消息
 */
export interface Message {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool' | 'system';

  /** 内容 */
  content: string;

  /** 时间戳 */
  timestamp: number;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会话状态
 */
export interface SessionState {
  /** 会话 ID */
  sessionId: string;

  /** 已完成的子任务 */
  completedSubtasks: string[];

  /** 待执行的子任务 */
  pendingSubtasks: string[];

  /** 失败的子任务 */
  failedSubtasks: string[];

  /** 检查点列表 */
  checkpoints: Checkpoint[];

  /** 变量 */
  variables: Record<string, unknown>;

  /** 当前计划 */
  currentPlan?: {
    planVersion: number;
    totalSubTasks: number;
    completedSubTasks: number;
  };

  /** 创建时间 */
  createdAt: number;

  /** 更新时间 */
  updatedAt: number;
}

/**
 * 检查点
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string;

  /** 时间戳 */
  timestamp: number;

  /** 保存的状态 */
  state: Record<string, unknown>;
}

/**
 * 记忆项
 */
export interface MemoryItem {
  /** 记忆 ID */
  id: string;

  /** Agent ID */
  agentId: string;

  /** 记忆类型 */
  type: 'conversation' | 'knowledge' | 'skill' | 'preference' | 'context';

  /** 内容 */
  content: string;

  /** 重要性（0-1） */
  importance: number;

  /** 访问次数 */
  accessCount: number;

  /** 最后访问时间 */
  lastAccessedAt: number;

  /** 创建时间 */
  createdAt: number;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 压缩策略
 */
export type CompressionStrategy = 'summary' | 'embedding' | 'hybrid';

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 原始 token 数 */
  originalTokens: number;

  /** 压缩后 token 数 */
  compressedTokens: number;

  /** 压缩率 */
  compressionRatio: number;

  /** 压缩后内容 */
  compressedContent: string;

  /** 策略 */
  strategy: CompressionStrategy;
}

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 最大记忆数 */
  maxItems: number;

  /** 重要性阈值（低于此值的会被淘汰） */
  importanceThreshold: number;

  /** 压缩策略 */
  compressionStrategy: CompressionStrategy;

  /** 自动压缩阈值（token 数） */
  autoCompressionThreshold: number;
}

/**
 * 记忆查询选项
 */
export interface MemoryQueryOptions {
  /** Agent ID */
  agentId?: string;

  /** 记忆类型 */
  type?: MemoryItem['type'];

  /** 最小重要性 */
  minImportance?: number;

  /** 限制数量 */
  limit?: number;

  /** 排序方式 */
  sortBy?: 'importance' | 'recency' | 'access';
}
