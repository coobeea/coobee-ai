/**
 * Orchestration 模块类型定义
 */

// ========== Task 相关类型 ==========

/**
 * 任务定义
 */
export interface Task {
  id: string;
  objective: string; // 任务目标
  description?: string;
  requirements?: string[]; // 任务需求
  context?: Record<string, unknown>; // 上下文信息
  constraints?: string[]; // 约束条件
}

/**
 * 子任务定义
 */
export interface SubTask {
  id: string;
  taskId: string; // 父任务ID
  name: string; // 任务名称（统一字段）
  description: string;
  dependencies?: string[]; // 依赖的子任务ID
  assignedWorker: string; // 分配的Worker（统一字段）
  status: SubTaskStatus;
  estimatedDuration?: number;
  context?: Record<string, unknown>;
  result?: unknown; // 执行结果
}

/**
 * 子任务状态
 */
export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 执行计划
 */
export interface ExecutionPlan {
  taskId: string;
  subTasks: SubTask[];
  stages: Stage[]; // 执行阶段
  estimatedDuration?: number;
  createdAt: number;
}

/**
 * 执行阶段
 */
export interface Stage {
  id: string;
  name: string;
  tasks: SubTask[]; // 这个阶段包含的子任务（统一字段）
  order: number; // 阶段顺序
  parallel: boolean; // 是否并行执行（统一字段）
  dependencies?: string[]; // 阶段依赖
}

/**
 * 执行阶段（兼容旧代码）
 */
export type ExecutionStage = Stage;

/**
 * Worker 信息
 */
export interface WorkerInfo {
  id: string;
  name: string;
  type?: string;
  status: 'idle' | 'busy' | 'error';
  currentTask?: string;
  currentTaskId?: string;
  agent?: { _config?: { name?: string } } | unknown;
}

// ========== Execution 相关类型 ==========

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  taskId: string;
  status: 'success' | 'partial' | 'failed';
  finalOutput?: string | { summary: string; results: unknown[] };
  subTaskResults: SubTaskExecutionResult[];
  stats: {
    startTime: number;
    endTime: number;
    duration: number;
    totalSubTasks: number;
    completedSubTasks: number;
    failedSubTasks: number;
  };
  /** Worker 产出的文件列表 */
  artifacts?: Array<{ name: string; path: string; workerId: string }>;
}

/**
 * 子任务执行结果
 */
export interface SubTaskExecutionResult {
  subTaskId: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  /** 执行耗时（ms） */
  duration?: number;
  /** 完成时间戳 */
  timestamp?: number;
}

// ========== Plan Version 相关类型 ==========

/**
 * 计划版本原因
 */
export enum PlanVersionReason {
  // 初始创建
  INITIAL = 'initial_planning',

  // 执行失败导致的重新规划
  TASK_FAILED = 'task_failed',
  VERIFICATION_FAILED = 'verification_failed',
  TIMEOUT = 'task_timeout',

  // 用户干预
  USER_INTERVENTION = 'user_intervention',
  USER_FEEDBACK = 'user_feedback',

  // 自适应优化
  OPTIMIZATION = 'performance_optimization',
  RESOURCE_CONSTRAINT = 'resource_constraint',

  // 需求变更
  REQUIREMENT_CHANGE = 'requirement_change'
}

/**
 * 计划版本元数据
 */
export interface PlanVersionMetadata {
  version: number;
  file: string;
  createdAt: number;
  createdBy: string; // agent ID
  reason: PlanVersionReason;
  reasonDetails?: string;
  parentVersion?: number | null; // 继承自哪个版本
  status: 'draft' | 'active' | 'replaced' | 'archived';

  // 统计信息
  stats: {
    totalSubTasks: number;
    totalStages: number;
    estimatedDuration: number;
    estimatedCost?: number;
  };

  // 执行结果（完成后填充）
  execution?: {
    startTime: number;
    endTime: number;
    duration: number;
    completedSubTasks: number;
    failedSubTasks: number;
    completionRate: number;
    successRate: number;
  };
}

/**
 * 计划索引
 */
export interface PlanIndex {
  sessionId: string;
  versions: PlanVersionMetadata[];
  currentVersion: number;
  totalVersions: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 计划变更记录
 */
export interface PlanChangeLog {
  timestamp: number;
  fromVersion: number | null;
  toVersion: number;
  type: 'create' | 'replan' | 'update' | 'archive';
  reason: PlanVersionReason;
  reasonDetails?: string;
  triggeredBy: 'orchestrator' | 'user' | 'system';
  changes?: {
    addedSubTasks: number;
    removedSubTasks: number;
    modifiedSubTasks: number;
  };
}

// ========== Verification 相关类型 ==========

/**
 * 验证规则
 */
export interface VerificationRule {
  id: string;
  name: string;
  type: 'format' | 'content' | 'structure' | 'logic' | 'custom';
  execute: (output: unknown) => Promise<VerificationResult>;
}

/**
 * 验证结果
 */
export interface VerificationResult {
  passed: boolean;
  ruleId: string;
  ruleName: string;
  message?: string;
  issues?: VerificationIssue[];
  suggestions?: string[];
}

/**
 * 验证问题
 */
export interface VerificationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  location?: {
    line?: number;
    column?: number;
    file?: string;
  };
}
