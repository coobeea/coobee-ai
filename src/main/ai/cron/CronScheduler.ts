/**
 * CronScheduler - Cron 作业调度器
 *
 * 职责：
 * - 使用 node-cron 管理定时任务
 * - 支持三种作业来源：
 *   1. 动态 Job — 用户通过页面/API 创建（JSON 持久化）
 *   2. 声明式 Job — src/main/jobs/ 下的 TypeScript 代码定义（编译时 glob）
 *   3. Extension Job — Extension 通过 api.registerCronJob() 注册（热插拔）
 * - 启动/停止/暂停作业
 * - 触发作业执行
 * - **Catch-up 机制** — 启动时检查并补执行错过的任务
 */

import * as cron from 'node-cron';
import CronExpressionParser from 'cron-parser';
import { log } from '@main/common/logger';
import { scanCronJobs } from '@main/common/scan';

import { CronJobStore } from './CronJobStore';
import { CronJobExecutor } from './CronJobExecutor';
import { BaseCronJob } from './types';
import type { CronJobDefinition } from './types';

export class CronScheduler {
  private store: CronJobStore;
  private executor: CronJobExecutor;
  private tasks = new Map<string, cron.ScheduledTask>();
  private running = false;

  constructor(store: CronJobStore, executor: CronJobExecutor) {
    this.store = store;
    this.executor = executor;
  }

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('[CronScheduler] 调度器已在运行');
      return;
    }

    log.info('[CronScheduler] 启动调度器');
    this.running = true;

    // 1. 扫描并注册声明式 Job（编译时 glob）
    await this.loadDeclarativeJobs();

    // 2. 加载所有已持久化的 Job（动态 + Extension 注册的）
    const jobs = await this.store.list();
    for (const job of jobs) {
      if (job.status === 'active' && !this.tasks.has(job.id)) {
        // ✅ 检查是否有错过的执行（Catch-up 机制）
        await this.checkAndCatchUpMissedRuns(job);

        // 调度未来的执行
        await this.scheduleJob(job);
      }
    }

    log.info(`[CronScheduler] 已调度 ${this.tasks.size} 个作业`);
  }

  /**
   * 扫描并注册声明式 Job（编译时 glob，src/main/jobs/）
   */
  private async loadDeclarativeJobs(): Promise<void> {
    try {
      const modules = scanCronJobs();

      let count = 0;
      for (const { path: modulePath, module: mod } of modules) {
        try {
          const defaultExport = (mod as Record<string, unknown>).default;
          if (!defaultExport || typeof defaultExport !== 'function') {
            continue;
          }

          const instance = new (defaultExport as new () => BaseCronJob)();
          if (!(instance instanceof BaseCronJob)) {
            log.warn(`[CronScheduler] ${modulePath} 的默认导出不是 BaseCronJob 子类，跳过`);
            continue;
          }

          if (!cron.validate(instance.cronExpression)) {
            log.error(`[CronScheduler] 声明式 Job ${instance.name} 的 cron 表达式无效: ${instance.cronExpression}`);
            continue;
          }

          this.executor.registerDeclarativeJob(instance);
          const definition = instance.toDefinition();

          const existing = await this.store.get(definition.id);
          if (existing) {
            if (existing.status !== 'active') {
              log.info(`[CronScheduler] 声明式 Job ${instance.name} 状态为 ${existing.status}，跳过调度`);
              continue;
            }
            definition.runCount = existing.runCount;
            definition.failCount = existing.failCount;
            definition.lastRunAt = existing.lastRunAt;
          } else {
            await this.store.save(definition);
          }

          await this.scheduleJob(definition);
          count++;
        } catch (err) {
          log.error(`[CronScheduler] 加载声明式 Job 失败: ${modulePath}`, err);
        }
      }

      if (count > 0) {
        log.info(`[CronScheduler] 已注册 ${count} 个声明式 Job`);
      }
    } catch (err) {
      log.warn('[CronScheduler] 声明式 Job 扫描失败', err);
    }
  }

  /**
   * 停止调度器
   */
  async stop(): Promise<void> {
    if (!this.running) {
      log.warn('[CronScheduler] 调度器未运行');
      return;
    }

    log.info('[CronScheduler] 停止调度器');

    for (const [jobId, task] of this.tasks) {
      task.stop();
      log.debug(`[CronScheduler] 停止作业: ${jobId}`);
    }

    this.tasks.clear();
    this.running = false;

    log.info('[CronScheduler] 调度器已停止');
  }

  /**
   * 调度单个作业
   */
  async scheduleJob(job: CronJobDefinition): Promise<boolean> {
    if (!cron.validate(job.cronExpression)) {
      log.error(`[CronScheduler] 无效的 cron 表达式: ${job.cronExpression}`);
      await this.store.update(job.id, {
        status: 'error',
        lastError: `无效的 cron 表达式: ${job.cronExpression}`
      });
      return false;
    }

    await this.unscheduleJob(job.id);

    const jobId = job.id;
    const task = cron.schedule(job.cronExpression, async () => {
      const latestJob = await this.store.get(jobId);
      if (!latestJob || latestJob.status !== 'active') {
        log.warn(`[CronScheduler] 作业 ${jobId} 已不活跃，跳过执行`);
        return;
      }
      log.info(`[CronScheduler] 触发作业: ${latestJob.id} - ${latestJob.name}`);
      await this.executor.execute(latestJob);
    });

    task.start();
    this.tasks.set(job.id, task);

    log.info(`[CronScheduler] 已调度作业: ${job.id} - ${job.name} (${job.cronExpression})`);
    return true;
  }

  /**
   * 取消调度作业
   */
  async unscheduleJob(jobId: string): Promise<void> {
    const task = this.tasks.get(jobId);
    if (task) {
      task.stop();
      this.tasks.delete(jobId);
      log.debug(`[CronScheduler] 取消调度作业: ${jobId}`);
    }
  }

  /**
   * 暂停作业
   */
  async pauseJob(jobId: string): Promise<boolean> {
    const task = this.tasks.get(jobId);
    if (!task) {
      log.warn(`[CronScheduler] 作业未调度: ${jobId}`);
      return false;
    }

    task.stop();
    await this.store.update(jobId, { status: 'paused' });
    log.info(`[CronScheduler] 暂停作业: ${jobId}`);
    return true;
  }

  /**
   * 恢复作业
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job) {
      log.warn(`[CronScheduler] 作业不存在: ${jobId}`);
      return false;
    }

    await this.store.update(jobId, { status: 'active' });
    return await this.scheduleJob(job);
  }

  /**
   * 立即执行作业（不影响调度）
   */
  async triggerJob(jobId: string): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job) {
      log.warn(`[CronScheduler] 作业不存在: ${jobId}`);
      return false;
    }

    log.info(`[CronScheduler] 手动触发作业: ${jobId} - ${job.name}`);
    await this.executor.execute(job);
    return true;
  }

  /**
   * 重新加载作业（更新后调用）
   */
  async reloadJob(jobId: string): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job) {
      log.warn(`[CronScheduler] 作业不存在: ${jobId}`);
      return false;
    }

    if (job.status === 'active') {
      return await this.scheduleJob(job);
    } else {
      await this.unscheduleJob(jobId);
      return true;
    }
  }

  /**
   * 规范化 Cron 表达式（5 位 → 6 位）
   *
   * node-cron 使用 5 位格式（分 时 日 月 周）
   * cron-parser 需要 6 位格式（秒 分 时 日 月 周）
   *
   * @example
   * normalizeCronExpression("30 5 * * *") → "0 30 5 * * *"
   * normalizeCronExpression("0 30 5 * * *") → "0 30 5 * * *" (已经是 6 位)
   */
  private normalizeCronExpression(expr: string): string {
    const parts = expr.trim().split(/\s+/);

    if (parts.length === 5) {
      // 5 位格式（node-cron 标准）→ 在秒位补 0
      return `0 ${expr}`;
    }

    if (parts.length >= 6) {
      // 已经是 6 位或 7 位（含年份）
      return expr;
    }

    throw new Error(`无效的 cron 表达式格式: ${expr}（期望 5 位或 6 位）`);
  }

  /**
   * 检查并补执行错过的任务（Catch-up 机制）
   *
   * 启动时调用，检查自上次执行以来是否有错过的调度时间。
   * 如果有，且在宽限期内，则立即执行一次。
   */
  private async checkAndCatchUpMissedRuns(job: CronJobDefinition): Promise<void> {
    // 默认启用 catch-up
    const catchUpEnabled = job.catchUpMissedRuns !== false;
    if (!catchUpEnabled) {
      log.debug(`[CronScheduler] 作业 ${job.id} 未启用 catch-up，跳过检查`);
      return;
    }

    // 如果从未执行过，不需要 catch-up
    if (!job.lastRunAt) {
      log.debug(`[CronScheduler] 作业 ${job.id} 从未执行过，跳过 catch-up`);
      return;
    }

    // 解析 cron 表达式
    let interval: ReturnType<typeof CronExpressionParser.parse>;
    try {
      // ✅ 规范化为 6 位格式（cron-parser 要求）
      const normalizedExpression = this.normalizeCronExpression(job.cronExpression);

      // cron-parser 使用本地时区
      interval = CronExpressionParser.parse(normalizedExpression, {
        currentDate: new Date(job.lastRunAt),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    } catch (err) {
      log.error(`[CronScheduler] 解析 cron 表达式失败: ${job.cronExpression}`, err);
      return;
    }

    // 计算下一次应该执行的时间
    const nextScheduledTime = interval.next().toDate();
    const now = new Date();

    // 如果下一次调度时间还没到，说明没有错过
    if (nextScheduledTime > now) {
      log.debug(`[CronScheduler] 作业 ${job.id} 未错过执行，下次执行: ${nextScheduledTime.toISOString()}`);
      return;
    }

    // 计算错过的时间（小时）
    const missedHours = (now.getTime() - nextScheduledTime.getTime()) / (1000 * 60 * 60);
    const gracePeriodHours = job.catchUpGracePeriodHours ?? 24;

    // 如果错过的时间超过宽限期，忽略
    if (missedHours > gracePeriodHours) {
      log.warn(
        `[CronScheduler] 作业 ${job.id} 错过执行已超过宽限期 (${missedHours.toFixed(1)}h > ${gracePeriodHours}h)，跳过补执行`
      );
      return;
    }

    // ✅ 补执行错过的任务
    log.info(
      `[CronScheduler] 作业 ${job.id} 检测到错过的执行 (应于 ${nextScheduledTime.toISOString()} 执行)，立即补执行`
    );

    // 异步执行，不阻塞调度器启动
    setImmediate(async () => {
      try {
        await this.executor.execute(job);
        log.info(`[CronScheduler] 作业 ${job.id} 补执行成功`);
      } catch (err) {
        log.error(`[CronScheduler] 作业 ${job.id} 补执行失败:`, err);
      }
    });
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    running: boolean;
    scheduledCount: number;
    jobs: Array<{ jobId: string; status: string }>;
  } {
    const jobs: Array<{ jobId: string; status: string }> = [];

    for (const [jobId] of this.tasks) {
      jobs.push({
        jobId,
        status: 'scheduled'
      });
    }

    return {
      running: this.running,
      scheduledCount: this.tasks.size,
      jobs
    };
  }
}
