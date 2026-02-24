/**
 * CronScheduler - Cron 作业调度器
 *
 * 职责：
 * - 使用 node-cron 管理定时任务
 * - 启动/停止/暂停作业
 * - 触发作业执行
 */

import * as cron from 'node-cron';
import { log } from '@main/common/logger';

import { CronJobStore } from './CronJobStore';
import { CronJobExecutor } from './CronJobExecutor';
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

    // 加载所有活跃作业
    const jobs = await this.store.list();
    for (const job of jobs) {
      if (job.status === 'active') {
        await this.scheduleJob(job);
      }
    }

    log.info(`[CronScheduler] 已调度 ${this.tasks.size} 个作业`);
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

    // 停止所有任务
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
    // 验证 cron 表达式
    if (!cron.validate(job.cronExpression)) {
      log.error(`[CronScheduler] 无效的 cron 表达式: ${job.cronExpression}`);
      await this.store.update(job.id, {
        status: 'error',
        lastError: `无效的 cron 表达式: ${job.cronExpression}`
      });
      return false;
    }

    // 如果已存在，先停止旧任务
    await this.unscheduleJob(job.id);

    // 创建新任务
    const task = cron.schedule(job.cronExpression, async () => {
      log.info(`[CronScheduler] 触发作业: ${job.id} - ${job.name}`);
      await this.executor.execute(job);
    });

    // 任务自动启动
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
