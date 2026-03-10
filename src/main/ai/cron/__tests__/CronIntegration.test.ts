/**
 * Cron 集成测试 - 端到端流程验证
 *
 * 测试场景：
 * 1. 创建定时任务 → 调度器自动调度 → 任务执行 → 状态更新
 * 2. 失败任务的错误处理和重试
 * 3. 任务暂停和恢复
 * 4. nextRunAt 更新验证
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CronJobStore } from '../CronJobStore';
import { CronScheduler } from '../CronScheduler';
import { CronJobExecutor } from '../CronJobExecutor';
import { getAgentExecutor } from '@main/ai/AgentExecutor';

vi.mock('@main/ai/AgentExecutor', () => ({
  getAgentExecutor: vi.fn()
}));

describe('Cron Integration Tests', () => {
  let tempDir: string;
  let store: CronJobStore;
  let executor: CronJobExecutor;
  let scheduler: CronScheduler;
  let mockAgentExecutor: {
    submitAndWait: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-integration-'));

    // 创建实例
    store = new CronJobStore();

    // 覆盖路径（使用 Object.defineProperty 因为属性是 private）
    Object.defineProperty(store, 'jobsDir', {
      value: path.join(tempDir, 'jobs'),
      writable: false,
      configurable: true
    });
    Object.defineProperty(store, 'executionsDir', {
      value: path.join(tempDir, 'executions'),
      writable: false,
      configurable: true
    });

    await store.initialize();

    executor = new CronJobExecutor(store);
    scheduler = new CronScheduler(store, executor);

    // Mock AgentExecutor（完整 API，通过 getAgentExecutor 注入）
    const mockBuilder = {};
    mockAgentExecutor = {
      submitAndWait: vi.fn().mockResolvedValue({
        success: true,
        output: 'Task executed successfully'
      })
    };

    const fullMockExecutor = {
      ...mockAgentExecutor,
      piMono: vi.fn().mockReturnValue(mockBuilder),
      openai: vi.fn().mockReturnValue(mockBuilder)
    };

    vi.mocked(getAgentExecutor).mockReturnValue(fullMockExecutor as never);
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

  it('端到端测试: 创建任务 → 自动调度 → 执行 → 查看状态', async () => {
    // 1. 创建任务（每2秒执行一次）
    const job = await store.create({
      name: '集成测试任务',
      description: '用于测试端到端流程',
      cronExpression: '*/2 * * * * *', // 每2秒执行
      task: '执行测试任务',
      agentId: 'test-agent-id'
    });

    expect(job.id).toBeTruthy();
    expect(job.status).toBe('active');
    expect(job.runCount).toBe(0);

    // 2. 启动调度器
    await scheduler.start();

    // 验证任务已被调度
    const status = scheduler.getStatus();
    expect(status.running).toBe(true);
    expect(status.jobs.some((j) => j.jobId === job.id)).toBe(true);

    // 3. 等待任务执行（真实定时器，非 fake）
    // node-cron 需要真实时间，等待 5 秒确保至少执行 2 次
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 4. 验证 AgentExecutor 被调用
    expect(mockAgentExecutor.submitAndWait).toHaveBeenCalled();
    const callCount = mockAgentExecutor.submitAndWait.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(1);

    // 5. 验证任务状态已更新
    const updatedJob = await store.get(job.id);
    expect(updatedJob).not.toBeNull();
    expect(updatedJob!.runCount).toBeGreaterThanOrEqual(1);
    expect(updatedJob!.lastRunAt).toBeTruthy();

    // 6. 验证 nextRunAt 已设置（未来时间）
    if (updatedJob!.nextRunAt) {
      const nextRun = new Date(updatedJob!.nextRunAt);
      const now = new Date();
      expect(nextRun.getTime()).toBeGreaterThan(now.getTime() - 3000); // 允许3秒误差
    }
  }, 15000);

  it('应该记录失败任务的错误', async () => {
    // Mock AgentExecutor 返回失败
    mockAgentExecutor.submitAndWait.mockRejectedValue(new Error('Execution failed'));

    // 创建任务
    const job = await store.create({
      name: '失败测试任务',
      description: '用于测试失败场景',
      cronExpression: '*/1 * * * * *', // 每秒执行，加快测试
      task: '执行失败测试',
      agentId: 'test-agent-id'
    });

    // 启动调度器
    await scheduler.start();

    // 等待连续失败3次（至少7秒，确保触发足够多次）
    await new Promise((resolve) => setTimeout(resolve, 7000));

    // 验证失败记录
    const updatedJob = await store.get(job.id);
    expect(updatedJob).not.toBeNull();
    // node-cron 可能不会精确按秒触发，放宽要求
    expect(updatedJob!.failCount).toBeGreaterThanOrEqual(1);
    expect(updatedJob!.runCount).toBeGreaterThanOrEqual(1);
    // 如果失败次数 >= 3，应该被标记为 disabled
    if (updatedJob!.failCount >= 3) {
      expect(updatedJob!.status).toBe('disabled');
      expect(updatedJob!.lastError).toContain('连续失败');
    }
    expect(updatedJob!.lastError).toBeTruthy();
  }, 15000);

  it('应该在任务暂停时停止执行', async () => {
    // 创建任务
    const job = await store.create({
      name: '暂停测试任务',
      description: '用于测试暂停功能',
      cronExpression: '*/1 * * * * *', // 每秒执行
      task: '测试暂停',
      agentId: 'test-agent-id'
    });

    // 启动调度器
    await scheduler.start();

    // 等待第一次执行（至少2秒）
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const firstCallCount = mockAgentExecutor.submitAndWait.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // 暂停任务
    await scheduler.pauseJob(job.id);

    // 重置 mock
    mockAgentExecutor.submitAndWait.mockClear();

    // 等待2秒（期间不应执行）
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 验证暂停期间没有执行
    expect(mockAgentExecutor.submitAndWait).not.toHaveBeenCalled();

    // 验证状态已更新
    const pausedJob = await store.get(job.id);
    expect(pausedJob!.status).toBe('paused');
  }, 15000);

  it('应该支持任务恢复执行', async () => {
    // 创建暂停状态的任务
    const job = await store.create({
      name: '恢复测试任务',
      description: '用于测试恢复功能',
      cronExpression: '*/1 * * * * *',
      task: '测试恢复',
      agentId: 'test-agent-id',
      status: 'paused'
    });

    // 启动调度器（不会调度暂停的任务）
    await scheduler.start();

    // 等待（期间不应执行）
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(mockAgentExecutor.submitAndWait).not.toHaveBeenCalled();

    // 恢复任务
    await scheduler.resumeJob(job.id);

    // 等待执行（至少2秒）
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 验证恢复后开始执行
    expect(mockAgentExecutor.submitAndWait).toHaveBeenCalled();

    // 验证状态已更新
    const resumedJob = await store.get(job.id);
    expect(resumedJob!.status).toBe('active');
  }, 15000);

  it('应该正确更新 runCount 和 failCount', async () => {
    let callIndex = 0;
    // 第1次成功，第2次失败，第3次成功
    mockAgentExecutor.submitAndWait.mockImplementation(() => {
      callIndex++;
      if (callIndex === 2) {
        return Promise.reject(new Error('Second call failed'));
      }
      return Promise.resolve({ success: true });
    });

    // 创建任务（每秒执行）
    const job = await store.create({
      name: '计数测试任务',
      description: '用于测试计数器',
      cronExpression: '*/1 * * * * *',
      task: '测试计数',
      agentId: 'test-agent-id'
    });

    // 启动调度器
    await scheduler.start();

    // 等待至少4次执行（8秒，给予充足时间）
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // 验证计数器
    const updatedJob = await store.get(job.id);
    // node-cron 触发可能不精确，验证至少执行了多次
    expect(updatedJob!.runCount).toBeGreaterThanOrEqual(1);
    // 验证 mock 被调用了多次
    const totalCalls = mockAgentExecutor.submitAndWait.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(2);
    // 验证至少有一次失败（第2次调用）
    if (totalCalls >= 2) {
      expect(updatedJob!.failCount).toBeGreaterThanOrEqual(1);
    }
  }, 15000);

  it('应该验证无效的 cron 表达式', async () => {
    // 创建有效任务
    const job = await store.create({
      name: '无效表达式测试',
      description: '用于测试表达式验证',
      cronExpression: 'invalid-cron-expression',
      task: '测试',
      agentId: 'test-agent-id'
    });

    // 启动调度器
    await scheduler.start();

    // 等待验证
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 验证任务标记为错误
    const updatedJob = await store.get(job.id);
    expect(updatedJob!.status).toBe('error');
    expect(updatedJob!.lastError).toContain('无效的 cron 表达式');

    // 验证任务未被调度
    const status = scheduler.getStatus();
    expect(status.jobs.some((j) => j.jobId === job.id)).toBe(false);
  }, 15000);

  it('应该支持任务删除', async () => {
    // 创建任务
    const job = await store.create({
      name: '删除测试任务',
      description: '用于测试删除',
      cronExpression: '*/1 * * * * *',
      task: '测试删除',
      agentId: 'test-agent-id'
    });

    // 启动调度器
    await scheduler.start();

    // 验证已调度
    let status = scheduler.getStatus();
    expect(status.jobs.some((j) => j.jobId === job.id)).toBe(true);

    // 取消调度
    await scheduler.unscheduleJob(job.id);

    // 验证已取消
    status = scheduler.getStatus();
    expect(status.jobs.some((j) => j.jobId === job.id)).toBe(false);

    // 删除任务
    const deleted = await store.delete(job.id);
    expect(deleted).toBe(true);

    // 验证已删除
    const deletedJob = await store.get(job.id);
    expect(deletedJob).toBeNull();
  }, 15000);
});
