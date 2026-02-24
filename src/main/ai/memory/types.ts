/**
 * 记忆系统类型定义
 */

// ========== Session Memory ==========

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ========== Working Memory / State ==========

/**
 * 会话状态
 */
export interface SessionState {
  sessionId: string;

  // 当前计划
  currentPlan?: {
    planVersion: number;
    totalSubTasks: number;
    completedSubTasks: number;
  };

  // 子任务状态
  completedSubtasks: string[];
  pendingSubtasks: string[];
  failedSubtasks: string[];

  // 检查点（断点续传）
  checkpoints: Array<{
    id: string;
    timestamp: number;
    state: Record<string, unknown>;
  }>;

  // 自定义变量
  variables: Record<string, unknown>;

  // 元数据
  createdAt: number;
  updatedAt: number;
}

/**
 * 检查点
 */
export interface Checkpoint {
  id: string;
  timestamp: number;
  state: Record<string, unknown>;
}

// ========== Long-Term Memory ==========

/**
 * 长期记忆类型
 */
export enum LongTermMemoryType {
  /** 语义记忆：事实性知识 */
  SEMANTIC = 'semantic',
  /** 情景记忆：具体事件 */
  EPISODIC = 'episodic',
  /** 程序记忆：如何做事 */
  PROCEDURAL = 'procedural',
  /** 用户偏好 */
  PREFERENCE = 'preference',
  /** 经验教训 */
  LESSON = 'lesson'
}

/**
 * 长期记忆条目
 */
export interface LongTermMemoryEntry {
  id: string;
  type: LongTermMemoryType;
  content: string;
  context?: string;
  importance: number; // 1-10
  userId?: string;
  sessionId?: string;
  embedding?: number[]; // 向量嵌入（可选）
  accessCount: number;
  createdAt: number;
  accessedAt?: number;
}

/**
 * 记忆检索查询
 */
export interface MemoryQuery {
  userId?: string;
  type?: LongTermMemoryType;
  minImportance?: number;
  limit?: number;
  keywords?: string[];
}
