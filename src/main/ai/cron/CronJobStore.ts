/**
 * CronJobStore - Cron 作业存储管理器
 *
 * 职责：
 * - 持久化 Cron 作业定义到 .home/cron/jobs/
 * - 提供 CRUD 操作
 * - 管理作业状态和执行记录
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';

import type { CronJobDefinition, CreateCronJobParams, UpdateCronJobParams, CronJobExecution } from './types';

export class CronJobStore {
  private jobsDir: string;
  private executionsDir: string;

  constructor() {
    this.jobsDir = path.join(Env.paths.userHome, 'cron', 'jobs');
    this.executionsDir = path.join(Env.paths.userHome, 'cron', 'executions');
  }

  /**
   * 初始化存储目录
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    await fs.mkdir(this.executionsDir, { recursive: true });
    log.info('[CronJobStore] 已初始化存储目录');
  }

  /**
   * 创建新的 Cron 作业
   */
  async create(params: CreateCronJobParams): Promise<CronJobDefinition> {
    const now = new Date().toISOString();
    const job: CronJobDefinition = {
      id: nanoid(),
      name: params.name,
      description: params.description,
      cronExpression: params.cronExpression,
      status: params.status || 'active',
      agentId: params.agentId,
      task: params.task,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      failCount: 0,
      metadata: params.metadata,
      // ✅ Catch-up 机制默认启用
      catchUpMissedRuns: params.catchUpMissedRuns ?? true,
      catchUpGracePeriodHours: params.catchUpGracePeriodHours ?? 24,
      // ✅ 通知默认启用
      sendNotification: params.sendNotification ?? true
    };

    await this.save(job);
    log.info(`[CronJobStore] 创建作业: ${job.id} - ${job.name}`);
    return job;
  }

  /**
   * 获取单个作业
   */
  async get(jobId: string): Promise<CronJobDefinition | null> {
    try {
      const filePath = this.getJobPath(jobId);
      const content = await fs.readFile(filePath, 'utf-8');
      const job: CronJobDefinition = JSON.parse(content);

      // ✅ 向后兼容：为旧 job 添加默认配置
      if (job.catchUpMissedRuns === undefined) {
        job.catchUpMissedRuns = true;
      }
      if (job.catchUpGracePeriodHours === undefined) {
        job.catchUpGracePeriodHours = 24;
      }
      if (job.sendNotification === undefined) {
        job.sendNotification = true;
      }

      return job;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * 列出所有作业
   */
  async list(): Promise<CronJobDefinition[]> {
    try {
      const files = await fs.readdir(this.jobsDir);
      const jobs: CronJobDefinition[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.jobsDir, file), 'utf-8');
          const job: CronJobDefinition = JSON.parse(content);

          // ✅ 向后兼容：为旧 job 添加默认配置
          if (job.catchUpMissedRuns === undefined) {
            job.catchUpMissedRuns = true;
          }
          if (job.catchUpGracePeriodHours === undefined) {
            job.catchUpGracePeriodHours = 24;
          }
          if (job.sendNotification === undefined) {
            job.sendNotification = true;
          }

          jobs.push(job);
        }
      }

      return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
      log.error('[CronJobStore] 列出作业失败', error);
      return [];
    }
  }

  /**
   * 更新作业
   */
  async update(jobId: string, params: UpdateCronJobParams): Promise<CronJobDefinition | null> {
    const job = await this.get(jobId);
    if (!job) {
      log.warn(`[CronJobStore] 作业不存在: ${jobId}`);
      return null;
    }

    const updated: CronJobDefinition = {
      ...job,
      ...params,
      updatedAt: new Date().toISOString()
    };

    await this.save(updated);
    log.info(`[CronJobStore] 更新作业: ${jobId}`);
    return updated;
  }

  /**
   * 删除作业
   */
  async delete(jobId: string): Promise<boolean> {
    try {
      const filePath = this.getJobPath(jobId);
      await fs.unlink(filePath);
      log.info(`[CronJobStore] 删除作业: ${jobId}`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * 更新作业执行状态
   */
  async updateExecutionStatus(
    jobId: string,
    updates: {
      lastRunAt?: string;
      nextRunAt?: string;
      runCount?: number;
      failCount?: number;
      lastError?: string;
    }
  ): Promise<void> {
    const job = await this.get(jobId);
    if (!job) return;

    const updated: CronJobDefinition = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.save(updated);
  }

  /**
   * 获取单次执行的存储路径（按 jobId 分目录，避免 getExecutions O(n) 全量扫描）
   */
  private getExecutionPath(execution: CronJobExecution): string {
    return path.join(this.executionsDir, execution.jobId, `${execution.id}.json`);
  }

  /**
   * 记录执行日志
   */
  async saveExecution(execution: CronJobExecution): Promise<void> {
    const filePath = this.getExecutionPath(execution);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(execution, null, 2), 'utf-8');
  }

  /**
   * 获取作业的执行历史
   *
   * 新结构：executions/{jobId}/{executionId}.json，仅扫描该 job 目录，O(m) 其中 m 为该 job 的执行数。
   * 兼容旧结构：若 jobId 目录不存在，回退到全量扫描（迁移期）。
   */
  async getExecutions(jobId: string, limit = 10): Promise<CronJobExecution[]> {
    try {
      const jobDir = path.join(this.executionsDir, jobId);

      try {
        const files = await fs.readdir(jobDir);
        const executions: CronJobExecution[] = [];

        for (const file of files) {
          if (file.endsWith('.json')) {
            const content = await fs.readFile(path.join(jobDir, file), 'utf-8');
            executions.push(JSON.parse(content));
          }
        }

        return executions
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
          .slice(0, limit);
      } catch (dirErr) {
        const err = dirErr as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') throw dirErr;
      }

      // 回退：旧结构 executions/{executionId}.json，全量扫描
      const files = await fs.readdir(this.executionsDir);
      const executions: CronJobExecution[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.executionsDir, file), 'utf-8');
          const execution: CronJobExecution = JSON.parse(content);
          if (execution.jobId === jobId) executions.push(execution);
        }
      }

      return executions
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, limit);
    } catch (error) {
      log.error('[CronJobStore] 获取执行历史失败', error);
      return [];
    }
  }

  /**
   * 保存作业到文件
   */
  async save(job: CronJobDefinition): Promise<void> {
    const filePath = this.getJobPath(job.id);
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
  }

  /**
   * 获取作业文件路径
   */
  private getJobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }
}
