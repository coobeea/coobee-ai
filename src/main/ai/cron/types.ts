/**
 * Cron Job 类型定义
 *
 * 支持三种来源：
 * 1. 动态 Job — 用户通过页面/API 创建，以 JSON 文件持久化在 .home/cron/jobs/
 * 2. 声明式 Job — 开发者通过代码定义，放在 src/main/jobs/ 目录下，启动时自动扫描注册
 * 3. Extension Job — Extension 通过 api.registerCronJob() 注册，热插拔时自动同步
 */

/** Cron 作业状态 */
export type CronJobStatus = 'active' | 'paused' | 'disabled' | 'error';

/** 作业来源 */
export type CronJobSource = 'dynamic' | 'declarative' | 'external';

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

  /** 作业来源（默认 dynamic） */
  source?: CronJobSource;
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

// ==================== 声明式 Job ====================

/** 声明式 Job 的执行上下文 */
export interface CronJobContext {
  jobId: string;
  jobName: string;
  startTime: Date;
}

/**
 * 声明式 CronJob 抽象基类
 *
 * 开发者在 src/main/jobs/ 目录下创建继承此基类的类并默认导出，
 * 应用启动时会自动扫描注册。
 *
 * @example
 * ```typescript
 * import { BaseCronJob, CronJobContext } from '@main/ai/cron/types';
 *
 * export default class HealthCheckJob extends BaseCronJob {
 *   readonly name = 'health-check';
 *   readonly description = '定期检查各 Worker 健康状态';
 *   readonly cronExpression = '0 *\/10 * * *'; // 每 10 分钟
 *
 *   async execute(ctx: CronJobContext): Promise<string> {
 *     // 自定义逻辑，返回执行结果摘要
 *     return 'All workers healthy';
 *   }
 * }
 * ```
 */
export abstract class BaseCronJob {
  /** 全局唯一标识（默认使用 name，也可覆盖） */
  get id(): string {
    return `declarative:${this.name}`;
  }

  /** Job 名称（英文标识符，不能重复） */
  abstract readonly name: string;

  /** Job 描述 */
  abstract readonly description: string;

  /** Cron 表达式（5 段标准格式：分 时 日 月 周） */
  abstract readonly cronExpression: string;

  /** 是否默认启用（默认 true） */
  readonly enabled: boolean = true;

  /** 关联的 Agent ID（可选，默认无需 Agent，由 execute 自行处理） */
  readonly agentId?: string;

  /**
   * 执行逻辑
   * @returns 结果摘要字符串
   */
  abstract execute(ctx: CronJobContext): Promise<string>;

  /**
   * 将声明式 Job 转换为标准 CronJobDefinition（供调度器统一管理）
   */
  toDefinition(): CronJobDefinition {
    const now = new Date().toISOString();
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      cronExpression: this.cronExpression,
      status: this.enabled ? 'active' : 'paused',
      agentId: this.agentId,
      task: '',
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      failCount: 0,
      source: 'declarative'
    };
  }
}
