import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CronJobStore } from '../CronJobStore';
import { CronScheduler } from '../CronScheduler';
import { CronJobExecutor } from '../CronJobExecutor';

describe('Cron System', () => {
  let tempDir: string;
  let store: CronJobStore;
  let executor: CronJobExecutor;
  let scheduler: CronScheduler;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-test-'));

    // 创建实例并覆盖路径
    store = new CronJobStore();
    Object.defineProperty(store, 'jobsDir', {
      value: path.join(tempDir, 'jobs'),
      writable: false
    });
    Object.defineProperty(store, 'executionsDir', {
      value: path.join(tempDir, 'executions'),
      writable: false
    });

    await store.initialize();

    executor = new CronJobExecutor(store);
    scheduler = new CronScheduler(store, executor);
  });

  afterEach(async () => {
    // 停止调度器
    if (scheduler) {
      await scheduler.stop();
    }

    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('CronJobStore', () => {
    it('应该创建新的定时任务', async () => {
      const job = await store.create({
        name: '测试任务',
        description: '每分钟执行一次',
        cronExpression: '* * * * *',
        task: '执行测试任务'
      });

      expect(job.id).toBeTruthy();
      expect(job.name).toBe('测试任务');
      expect(job.status).toBe('active');
      expect(job.runCount).toBe(0);
      expect(job.failCount).toBe(0);
    });

    it('应该列出所有任务', async () => {
      await store.create({
        name: '任务1',
        description: '测试任务1',
        cronExpression: '* * * * *',
        task: '任务1'
      });

      await store.create({
        name: '任务2',
        description: '测试任务2',
        cronExpression: '* * * * *',
        task: '任务2'
      });

      const jobs = await store.list();
      expect(jobs).toHaveLength(2);
    });

    it('应该更新任务', async () => {
      const job = await store.create({
        name: '原名称',
        description: '原描述',
        cronExpression: '* * * * *',
        task: '原任务'
      });

      const updated = await store.update(job.id, {
        name: '新名称',
        description: '新描述'
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('新名称');
      expect(updated!.description).toBe('新描述');
      expect(updated!.task).toBe('原任务');
    });

    it('应该删除任务', async () => {
      const job = await store.create({
        name: '待删除任务',
        description: '测试删除',
        cronExpression: '* * * * *',
        task: '任务'
      });

      const success = await store.delete(job.id);
      expect(success).toBe(true);

      const retrieved = await store.get(job.id);
      expect(retrieved).toBeNull();
    });

    it('应该更新执行状态', async () => {
      const job = await store.create({
        name: '状态更新测试',
        description: '测试',
        cronExpression: '* * * * *',
        task: '任务'
      });

      await store.updateExecutionStatus(job.id, {
        lastRunAt: new Date().toISOString(),
        runCount: 5,
        failCount: 1
      });

      const updated = await store.get(job.id);
      expect(updated).not.toBeNull();
      expect(updated!.runCount).toBe(5);
      expect(updated!.failCount).toBe(1);
      expect(updated!.lastRunAt).toBeTruthy();
    });
  });

  describe('CronScheduler', () => {
    it('应该验证 cron 表达式', async () => {
      const validJob = await store.create({
        name: '有效任务',
        description: '有效 cron 表达式',
        cronExpression: '*/5 * * * *',
        task: '任务'
      });

      const success = await scheduler.scheduleJob(validJob);
      expect(success).toBe(true);
    });

    it('应该拒绝无效的 cron 表达式', async () => {
      const invalidJob = await store.create({
        name: '无效任务',
        description: '无效 cron 表达式',
        cronExpression: 'invalid cron',
        task: '任务',
        status: 'disabled'
      });

      const success = await scheduler.scheduleJob(invalidJob);
      expect(success).toBe(false);

      const updated = await store.get(invalidJob.id);
      expect(updated!.status).toBe('error');
    });

    it('应该启动和停止调度器', async () => {
      await scheduler.start();
      const status1 = scheduler.getStatus();
      expect(status1.running).toBe(true);

      await scheduler.stop();
      const status2 = scheduler.getStatus();
      expect(status2.running).toBe(false);
    });

    it('应该跟踪已调度的任务', async () => {
      const job1 = await store.create({
        name: '任务1',
        description: '测试',
        cronExpression: '* * * * *',
        task: '任务1'
      });

      const job2 = await store.create({
        name: '任务2',
        description: '测试',
        cronExpression: '* * * * *',
        task: '任务2'
      });

      await scheduler.scheduleJob(job1);
      await scheduler.scheduleJob(job2);

      const status = scheduler.getStatus();
      expect(status.scheduledCount).toBe(2);
      expect(status.jobs).toHaveLength(2);
    });

    it('应该取消调度任务', async () => {
      const job = await store.create({
        name: '待取消任务',
        description: '测试',
        cronExpression: '* * * * *',
        task: '任务'
      });

      await scheduler.scheduleJob(job);
      expect(scheduler.getStatus().scheduledCount).toBe(1);

      await scheduler.unscheduleJob(job.id);
      expect(scheduler.getStatus().scheduledCount).toBe(0);
    });
  });

  describe('CronJobExecutor', () => {
    it('应该记录正在执行的任务', () => {
      const running = executor.getRunningExecutions();
      expect(Array.isArray(running)).toBe(true);
    });
  });

  describe('Integration', () => {
    it('应该完整流程：创建 -> 调度 -> 查询状态', async () => {
      // 创建任务
      const job = await store.create({
        name: '集成测试任务',
        description: '完整流程测试',
        cronExpression: '*/5 * * * *',
        task: '执行集成测试'
      });

      expect(job.id).toBeTruthy();

      // 调度任务
      const scheduled = await scheduler.scheduleJob(job);
      expect(scheduled).toBe(true);

      // 查询状态
      const status = scheduler.getStatus();
      expect(status.scheduledCount).toBe(1);
      expect(status.jobs[0].jobId).toBe(job.id);
      expect(status.jobs[0].status).toBe('scheduled');
    });
  });
});
