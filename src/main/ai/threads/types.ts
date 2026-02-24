/**
 * Thread（会话线程）类型定义
 *
 * Thread 是用户与 Agent 之间的一次完整对话会话。
 * 持久化到 .home/threads/{threadId}.json，ID 使用 Snowflake 算法生成（有序）。
 *
 * 设计：
 *   - threadId 采用 Snowflake ID，天然有序，按 ID 降序 = 按时间降序
 *   - threadId = sessionId（统一标识，workspace 目录以此命名）
 *   - 每个 Thread 绑定一个 agentId（哪个智能体在处理）
 *   - status 表示会话状态：active / archived / deleted
 *   - runStatus 跟踪运行时详细状态（idle / running / approval-pending 等）
 *   - 文件存储，重启后保留
 */

import type { AgentMode } from '../runtime/types';

// ==================== Thread 运行时状态 ====================

/** Thread 运行时状态（跟踪当前执行进度） */
export type ThreadRunStatus = 'idle' | 'running' | 'tool-pending' | 'approval-pending' | 'completed' | 'error';

/** Agent 分类类型（用于前端展示和模式区分） */
export type AgentType = 'agent' | 'orchestrator' | 'swarm' | 'discussion';

// ==================== Thread 定义 ====================

/** Thread 状态 */
export type ThreadStatus = 'active' | 'archived' | 'deleted';

/** Thread 完整定义（持久化到 .home/threads/{id}.json） */
export interface ThreadDefinition {
  /** 唯一标识（Snowflake ID，字符串形式） */
  id: string;

  /** 显示标题（通常从第一条用户消息截取，或用户手动修改） */
  title: string;

  /** 关联的 Agent ID（哪个智能体处理此会话） */
  agentId: string;

  /** 会话状态 */
  status: ThreadStatus;

  /** 会话 ID（等于 threadId，workspace 以此命名） */
  sessionId: string;

  /** Agent 运行模式 */
  agentMode: AgentMode;

  /** Agent 分类类型 */
  agentType: AgentType;

  /** 运行时状态（跟踪当前执行进度） */
  runStatus: ThreadRunStatus;

  /** 消息数量（轻量统计，避免前端需要加载全部消息） */
  messageCount: number;

  /** 创建时间（ISO 8601） */
  createdAt: string;

  /** 最后更新时间（ISO 8601） */
  updatedAt: string;

  /** 扩展元数据（保留字段） */
  metadata?: Record<string, unknown>;
}

// ==================== 索引条目（轻量级列表用） ====================

/** Thread 索引条目（用于 list 操作） */
export interface ThreadIndexEntry {
  id: string;
  title: string;
  agentId: string;
  status: ThreadStatus;
  runStatus: ThreadRunStatus;
  agentType: AgentType;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  /** 该 Thread 的工作空间绝对路径（= workspacesDir/{id}） */
  workspacePath: string;
}

// ==================== 创建 / 更新参数 ====================

/** 创建 Thread 的输入参数 */
export interface CreateThreadParams {
  /** 显示标题 */
  title: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** Agent 运行模式（默认 'agent'） */
  agentMode?: AgentMode;
  /** Agent 分类类型（默认 'agent'） */
  agentType?: AgentType;
  /** 扩展元数据（可选） */
  metadata?: Record<string, unknown>;
}

/** 更新 Thread 的输入参数（部分更新） */
export interface UpdateThreadParams {
  title?: string;
  status?: ThreadStatus;
  runStatus?: ThreadRunStatus;
  messageCount?: number;
  metadata?: Record<string, unknown>;
}

// ==================== 检查点（Checkpoint） ====================

/**
 * Thread 检查点
 *
 * 记录 Thread 的全局执行快照，存储在 workspace/{threadId}/checkpoint.json。
 * 一个 Thread 只有一个检查点（覆盖更新），用于异步审批恢复和崩溃恢复。
 */
export interface ThreadCheckpoint {
  /** Thread ID */
  threadId: string;

  /** 最后更新时间 */
  updatedAt: string;

  /** 当前运行状态 */
  runStatus: ThreadRunStatus;

  /** 当前活跃的子 Agent（仅在子 Agent 执行时有值） */
  activeAgent?: {
    sessionId: string;
    agentId: string;
    role: 'delegate' | 'worker' | 'swarm-role' | 'planner';
    workspace: string;
  };

  /** 等待中的操作（审批或长时间工具执行） */
  pendingOperation?: {
    type: 'approval' | 'tool-execution';
    approvalId?: string;
    toolName: string;
    toolCallId: string;
    agentSessionId: string;
    /** 工具参数（JSON 字符串，用于重启后恢复显示） */
    arguments?: string;
  };
}
