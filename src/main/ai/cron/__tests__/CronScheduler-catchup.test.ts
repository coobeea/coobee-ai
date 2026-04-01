/**
 * CronScheduler - Catch-up 机制集成测试
 *
 * 测试错过执行的任务是否能够正确补执行
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CronScheduler } from '../CronScheduler';
import { CronJobStore } from '../CronJobStore';
import { CronJobExecutor } from '../CronJobExecutor';

describe('CronScheduler - Catch-up 机制', () => {
  let tempDir: string;
  let store: CronJobStore;
  let executor: CronJobExecutor;
  let scheduler: CronScheduler;
  let executeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 创建临时目录（未使用，因为 CronJobStore 使用 Env.paths.userHome）
    tempDir = mkdtempSync(join(tmpdir(), 'cron-catchup-test-'));

    // 初始化组件
    store = new CronJobStore();
    executor = new CronJobExecutor(store);
    scheduler = new CronScheduler(store, executor);

    // 监听 executor.execute 调用
    executeSpy = vi.spyOn(executor, 'execute');
  });

  afterEach(() => {
    // 停止调度器
    scheduler.stop();

    // 清理临时目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('清理临时目录失败:', err);
    }

    // 清理 spy
    vi.restoreAllMocks();
  });

  /**
   * 辅助函数：创建指定时间的 Date 对象
   */
  function createDateFromNow(hoursAgo: number, minutesAgo = 0): Date {
    const date = new Date();
    date.setHours(date.getHours() - hoursAgo);
    date.setMinutes(date.getMinutes() - minutesAgo);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
  }

  describe('在宽限期内补执行', () => {
    it('应该补执行 5 小时前错过的任务', async () => {
      // Given: 创建任务，模拟 5 小时前执行过
      const job = await store.create({
        name: '测试任务 - 5小时前',
        description: '测试 Catch-up 机制',
        cronExpression: '0 9 * * *', // 每天 09:00
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 24
      });

      // 模拟 lastRunAt（5 小时前的 09:00）
      const fiveHoursAgo = createDateFromNow(5);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: fiveHoursAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();

      // 等待补执行（setImmediate 需要一点时间）
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 应该触发补执行
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该补执行 1 天前错过的任务（边界情况）', async () => {
      // Given: 创建任务，模拟 23 小时前执行过（刚好在 24 小时宽限期内）
      const job = await store.create({
        name: '测试任务 - 23小时前',
        description: '测试边界情况',
        cronExpression: '0 10 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 24
      });

      const twentyThreeHoursAgo = createDateFromNow(23);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: twentyThreeHoursAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 应该触发补执行
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该补执行使用 5 位 cron 表达式的任务', async () => {
      // Given: 使用 5 位格式创建任务
      const job = await store.create({
        name: '测试任务 - 5位格式',
        description: '测试 5 位格式兼容性',
        cronExpression: '30 5 * * *', // ⚠️ 5 位格式
        agentId: 'test-agent',
        task: '测试内容'
      });

      const yesterday = createDateFromNow(24);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: yesterday.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 应该能够正确解析并补执行
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });
  });

  describe('超过宽限期不补执行', () => {
    it('应该跳过 30 天前错过的任务', async () => {
      // Given: 创建任务，模拟 30 天前执行过
      const job = await store.create({
        name: '测试任务 - 30天前',
        description: '测试超过宽限期',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 24
      });

      const thirtyDaysAgo = createDateFromNow(30 * 24);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: thirtyDaysAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));

      // 验证任务仍然被正常调度
      const status = scheduler.getStatus();
      expect(status.scheduledCount).toBeGreaterThan(0);
    });

    it('应该跳过刚好超过宽限期的任务（边界情况）', async () => {
      // Given: 创建任务，模拟 26 小时前执行过（明确超过 24 小时）
      const job = await store.create({
        name: '测试任务 - 26小时前',
        description: '测试宽限期边界',
        cronExpression: '0 10 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 24
      });

      // 确保明确超过宽限期：26 小时前
      const twentySixHoursAgo = createDateFromNow(26);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: twentySixHoursAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行（超过 24 小时）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });
  });

  describe('特殊情况处理', () => {
    it('应该跳过从未执行过的任务', async () => {
      // Given: 创建新任务，从未执行
      const job = await store.create({
        name: '测试任务 - 从未执行',
        description: '测试新任务场景',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '测试内容'
      });

      // lastRunAt: undefined, runCount: 0

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行（因为从未执行过）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该跳过禁用 catch-up 的任务', async () => {
      // Given: 创建任务，显式禁用 catch-up
      const job = await store.create({
        name: '测试任务 - 禁用catchup',
        description: '测试禁用 catch-up',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: false // ⚠️ 禁用
      });

      const yesterday = createDateFromNow(24);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: yesterday.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该跳过未到执行时间的任务', async () => {
      // Given: 创建任务，下次执行时间还没到
      const job = await store.create({
        name: '测试任务 - 未到时间',
        description: '测试未到执行时间',
        cronExpression: '0 23 * * *', // 今晚 23:00
        agentId: 'test-agent',
        task: '测试内容'
      });

      // 模拟昨天 23:00 执行过
      const yesterday23 = new Date();
      yesterday23.setDate(yesterday23.getDate() - 1);
      yesterday23.setHours(23, 0, 0, 0);

      await store.updateExecutionStatus(job.id, {
        lastRunAt: yesterday23.toISOString(),
        runCount: 1
      });

      // When: 启动调度器（假设当前时间是白天，还没到今晚 23:00）
      const now = new Date();
      if (now.getHours() < 23) {
        await scheduler.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Then: 不应该触发补执行（因为今天 23:00 还没到）
        expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
      }
    });
  });

  describe('自定义宽限期', () => {
    it('应该支持自定义宽限期（48 小时）', async () => {
      // Given: 创建任务，宽限期 48 小时
      const job = await store.create({
        name: '测试任务 - 48小时宽限期',
        description: '测试自定义宽限期 48h',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 48 // ⚠️ 自定义宽限期
      });

      // 模拟 36 小时前执行过
      const thirtyFiveHoursAgo = createDateFromNow(36);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: thirtyFiveHoursAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 应该触发补执行（因为 36h < 48h）
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该支持 0 小时宽限期（禁用补执行）', async () => {
      // Given: 创建任务，宽限期 0 小时
      const job = await store.create({
        name: '测试任务 - 0小时宽限期',
        description: '测试 0 小时宽限期',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '测试内容',
        catchUpMissedRuns: true,
        catchUpGracePeriodHours: 0 // ⚠️ 禁用补执行
      });

      // 模拟 1 小时前执行过
      const oneHourAgo = createDateFromNow(1);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: oneHourAgo.toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行（因为宽限期为 0）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });
  });

  describe('多任务场景', () => {
    it('应该能够处理多个任务的混合情况', async () => {
      // Given: 创建 3 个任务
      // 任务 1：应该补执行
      const job1 = await store.create({
        name: '任务1 - 应补执行',
        description: '测试任务 1',
        cronExpression: '0 9 * * *',
        agentId: 'test-agent',
        task: '任务1'
      });
      await store.updateExecutionStatus(job1.id, {
        lastRunAt: createDateFromNow(5).toISOString(),
        runCount: 1
      });

      // 任务 2：超过宽限期
      const job2 = await store.create({
        name: '任务2 - 超过宽限期',
        description: '测试任务 2',
        cronExpression: '0 10 * * *',
        agentId: 'test-agent',
        task: '任务2'
      });
      await store.updateExecutionStatus(job2.id, {
        lastRunAt: createDateFromNow(30 * 24).toISOString(),
        runCount: 1
      });

      // 任务 3：从未执行
      await store.create({
        name: '任务3 - 从未执行',
        description: '测试任务 3',
        cronExpression: '0 11 * * *',
        agentId: 'test-agent',
        task: '任务3'
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Then: 只有任务 1 应该补执行
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job1.id }));
    });
  });

  describe('真实场景模拟', () => {
    it('应该模拟"起床提醒"任务的场景（22 天未执行）', async () => {
      // Given: 模拟"起床提醒"任务
      const job = await store.create({
        name: '起床提醒',
        description: '每天早上提醒用户起床',
        cronExpression: '30 5 * * *', // ⚠️ 5 位格式
        agentId: 'app-copilot',
        task: '请提醒用户起床了！'
      });

      // 模拟 22 天前执行过
      const twentyTwoDaysAgo = createDateFromNow(22 * 24);
      await store.updateExecutionStatus(job.id, {
        lastRunAt: twentyTwoDaysAgo.toISOString(),
        runCount: 3
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该补执行（超过 24 小时宽限期）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });

    it('应该模拟"证券数据抓取"任务的场景（1 天未执行）', async () => {
      // Given: 模拟"证券数据抓取"任务
      const job = await store.create({
        name: '证券数据抓取',
        description: '工作日抓取证券数据',
        cronExpression: '0 16 * * 1-5', // ⚠️ 工作日 16:00
        agentId: 'app-copilot',
        task: '抓取证券数据'
      });

      // 模拟昨天 16:00 执行过，但当前时间必须晚于今天 16:00（才算错过）
      const yesterday16 = new Date();
      yesterday16.setDate(yesterday16.getDate() - 1);
      yesterday16.setHours(16, 0, 0, 0);

      await store.updateExecutionStatus(job.id, {
        lastRunAt: yesterday16.toISOString(),
        runCount: 3
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 根据当前时间判断
      const now = new Date();
      const todayIs16OrLater = now.getHours() >= 16;
      const isWorkday = [1, 2, 3, 4, 5].includes(now.getDay());

      if (todayIs16OrLater && isWorkday) {
        // 今天 16:00 已过，应该补执行
        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
      } else {
        // 今天 16:00 还没到，或今天不是工作日，不应该补执行
        expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
      }
    });

    it('应该模拟"每日会话沉淀"任务的场景（从未执行）', async () => {
      // Given: 模拟新创建的任务
      const job = await store.create({
        name: '每日会话沉淀',
        description: '每天凌晨沉淀会话内容',
        cronExpression: '0 1 * * *',
        agentId: 'session-content-extractor',
        task: '扫描前一天的会话记录'
      });

      // runCount: 0, lastRunAt: undefined

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行（因为从未执行过）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });
  });

  describe('解析错误处理', () => {
    it('应该正确处理无效的 cron 表达式', async () => {
      // Given: 创建任务，使用无效的 cron 表达式
      const job = await store.create({
        name: '测试任务 - 无效表达式',
        description: '测试无效表达式处理',
        cronExpression: '99 99 * * *', // ⚠️ 无效
        agentId: 'test-agent',
        task: '测试内容'
      });

      await store.updateExecutionStatus(job.id, {
        lastRunAt: createDateFromNow(5).toISOString(),
        runCount: 1
      });

      // When: 启动调度器
      await scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then: 不应该触发补执行（解析失败）
      expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    });
  });
});
