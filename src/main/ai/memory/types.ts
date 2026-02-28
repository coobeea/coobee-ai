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
