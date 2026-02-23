/**
 * 定时任务类型定义
 */

/**
 * 定时任务状态
 */
export type CronJobStatus = 'active' | 'paused' | 'error';

/**
 * 定时任务定义
 */
export interface CronJob {
  /** 任务 ID (Snowflake) */
  id: string;

  /** 任务名称 */
  name: string;

  /** 任务描述（一句话） */
  description: string;

  /** Cron 表达式 (例如: "0 9 * * *" 表示每天上午9点) */
  cronExpression: string;

  /** 任务状态 */
  status: CronJobStatus;

  /** 关联的智能体 ID */
  agentId: string;

  /** 创建时间 (ISO 8601) */
  createdAt: string;

  /** 更新时间 (ISO 8601) */
  updatedAt: string;

  /** 上次执行时间 (ISO 8601) */
  lastRunAt?: string;

  /** 下次执行时间 (ISO 8601) */
  nextRunAt?: string;

  /** 执行次数 */
  runCount: number;

  /** 最后一次执行结果 */
  lastRunResult?: {
    success: boolean;
    message?: string;
    threadId?: string;
  };
}

/**
 * 创建定时任务的参数
 */
export interface CreateCronJobParams {
  name: string;
  description: string;
  cronExpression: string;
  agentId: string;
}

/**
 * 更新定时任务的参数
 */
export interface UpdateCronJobParams {
  name?: string;
  description?: string;
  cronExpression?: string;
  status?: CronJobStatus;
}
