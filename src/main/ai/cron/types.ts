/**
 * Cron Job 类型定义
 */

/** Cron 作业状态 */
export type CronJobStatus = 'active' | 'paused' | 'disabled' | 'error';

/** Cron 作业定义 */
export interface CronJobDefinition {
  /** 作业 ID */
  id: string;

  /** 作业名称 */
  name: string;

  /** 作业描述（一句话需求） */
  description: string;

  /** Cron 表达式（标准 cron 格式） */
  cronExpression: string;

  /** 作业状态 */
  status: CronJobStatus;

  /** 关联的 Agent ID（可选，默认使用系统默认 Agent） */
  agentId?: string;

  /** 要执行的任务（用户输入的需求） */
  task: string;

  /** 创建时间 */
  createdAt: string;

  /** 更新时间 */
  updatedAt: string;

  /** 最后执行时间 */
  lastRunAt?: string;

  /** 下次执行时间 */
  nextRunAt?: string;

  /** 执行次数 */
  runCount: number;

  /** 失败次数 */
  failCount: number;

  /** 最后错误信息 */
  lastError?: string;

  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/** 创建 Cron 作业的参数 */
export interface CreateCronJobParams {
  name: string;
  description: string;
  cronExpression: string;
  task: string;
  agentId?: string;
  status?: CronJobStatus;
  metadata?: Record<string, unknown>;
}

/** 更新 Cron 作业的参数 */
export interface UpdateCronJobParams {
  name?: string;
  description?: string;
  cronExpression?: string;
  task?: string;
  agentId?: string;
  status?: CronJobStatus;
  lastError?: string;
  metadata?: Record<string, unknown>;
}

/** Cron 作业执行记录 */
export interface CronJobExecution {
  /** 执行 ID */
  id: string;

  /** 作业 ID */
  jobId: string;

  /** 开始时间 */
  startedAt: string;

  /** 结束时间 */
  endedAt?: string;

  /** 执行状态 */
  status: 'running' | 'success' | 'failed';

  /** 执行结果 */
  result?: string;

  /** 错误信息 */
  error?: string;

  /** 执行日志 */
  logs?: string[];
}
