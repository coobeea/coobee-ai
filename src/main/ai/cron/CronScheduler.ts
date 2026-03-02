/**
 * CronScheduler - Cron 作业调度器
 *
 * 职责：
 * - 使用 node-cron 管理定时任务
 * - 支持三种作业来源：
 *   1. 动态 Job — 用户通过页面/API 创建（JSON 持久化）
 *   2. 声明式 Job — src/main/cron-jobs/ 下的 TypeScript 代码定义（编译时 glob）
 *   3. 外部 Job — workers/、extensions/ 等目录下的 cron-job.json（运行时 fs 扫描）
 * - 启动/停止/暂停作业
 * - 触发作业执行
 */

import fs from 'node:fs';
import path from 'node:path';
import * as cron from 'node-cron';
import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import { scanCronJobs } from '@main/common/scan';

import { CronJobStore } from './CronJobStore';
import { CronJobExecutor } from './CronJobExecutor';
import { BaseCronJob } from './types';
import type { CronJobDefinition } from './types';

// cron-job.json 文件格式（外部目录定义）
// {
//   "name": "tavern-sync",
//   "description": "定时同步酒馆数据",
//   "cronExpression": "0 */6 * * *",
//   "task": "请同步酒馆最新数据到本地缓存",
//   "agentId": "app-copilot",
//   "enabled": true
// }
interface ExternalCronJobConfig {
  name: string;
  description: string;
  cronExpression: string;
  task: string;
  agentId?: string;
  enabled?: boolean;
}

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

    // 2. 扫描并注册外部目录 Job（运行时 fs 扫描）
    await this.loadExternalJobs();

    // 3. 加载动态配置的 Job（用户通过页面创建的）
    const jobs = await this.store.list();
    for (const job of jobs) {
      if (job.status === 'active' && !this.tasks.has(job.id)) {
        await this.scheduleJob(job);
      }
    }

    log.info(`[CronScheduler] 已调度 ${this.tasks.size} 个作业`);
  }

  /**
   * 扫描并注册声明式 Job（编译时 glob，src/main/cron-jobs/）
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
   * 运行时 fs 扫描外部目录中的 cron-job.json 文件
   *
   * 扫描规则（类似 WorkerManager 的 worker.json 模式）：
   * - 遍历 scanDirs 中每个顶级子目录
   * - 查找 cron-job.json 文件
   * - 解析为 CronJobDefinition 并注册
   */
  private async loadExternalJobs(): Promise<void> {
    const scanDirs = [Env.paths.workersDir, Env.paths.builtinExtensionsDir, Env.paths.userExtensionsDir];

    let totalCount = 0;

    for (const baseDir of scanDirs) {
      if (!fs.existsSync(baseDir)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const configPath = path.join(baseDir, entry.name, 'cron-job.json');
        if (!fs.existsSync(configPath)) continue;

        try {
          const raw = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(raw) as ExternalCronJobConfig;

          if (!config.name || !config.cronExpression || !config.task) {
            log.warn(`[CronScheduler] 外部 Job 配置不完整: ${configPath}`);
            continue;
          }

          if (!cron.validate(config.cronExpression)) {
            log.error(`[CronScheduler] 外部 Job ${config.name} 的 cron 表达式无效: ${config.cronExpression}`);
            continue;
          }

          const jobId = `external:${entry.name}:${config.name}`;

          const existing = await this.store.get(jobId);
          if (existing) {
            if (existing.status !== 'active') {
              log.info(`[CronScheduler] 外部 Job ${config.name} 状态为 ${existing.status}，跳过调度`);
              continue;
            }
            await this.scheduleJob(existing);
          } else {
            const now = new Date().toISOString();
            const definition: CronJobDefinition = {
              id: jobId,
              name: config.name,
              description: config.description || '',
              cronExpression: config.cronExpression,
              status: config.enabled !== false ? 'active' : 'paused',
              agentId: config.agentId,
              task: config.task,
              createdAt: now,
              updatedAt: now,
              runCount: 0,
              failCount: 0,
              source: 'external',
              metadata: { configPath, directory: entry.name }
            };

            await this.store.save(definition);

            if (definition.status === 'active') {
              await this.scheduleJob(definition);
            }
          }

          totalCount++;
        } catch (err) {
          log.error(`[CronScheduler] 加载外部 Job 失败: ${configPath}`, err);
        }
      }
    }

    if (totalCount > 0) {
      log.info(`[CronScheduler] 已注册 ${totalCount} 个外部 Job`);
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
