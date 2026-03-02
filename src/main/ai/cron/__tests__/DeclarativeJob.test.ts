import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CronJobStore } from '../CronJobStore';
import { CronJobExecutor } from '../CronJobExecutor';
import { BaseCronJob } from '../types';
import type { CronJobContext } from '../types';

vi.mock('@main/ai/AgentExecutor', () => ({
  getAgentExecutor: vi.fn()
}));

class TestDeclarativeJob extends BaseCronJob {
  readonly name = 'test-declarative';
  readonly description = '测试用声明式 Job';
  readonly cronExpression = '*/5 * * * *';

  executeResult = 'test result';
  executeCalled = false;

  async execute(_ctx: CronJobContext): Promise<string> {
    this.executeCalled = true;
    return this.executeResult;
  }
}

class DisabledTestJob extends BaseCronJob {
  readonly name = 'test-disabled';
  readonly description = '默认禁用的测试 Job';
  readonly cronExpression = '0 * * * *';
  readonly enabled = false;

  async execute(): Promise<string> {
    return 'should not run';
  }
}

class FailingJob extends BaseCronJob {
  readonly name = 'test-failing';
  readonly description = '会失败的测试 Job';
  readonly cronExpression = '*/5 * * * *';

  async execute(): Promise<string> {
    throw new Error('deliberate failure');
  }
}

describe('Declarative CronJob', () => {
  let tempDir: string;
  let store: CronJobStore;
  let executor: CronJobExecutor;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-declarative-'));

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
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('BaseCronJob', () => {
    it('应该生成正确的 id', () => {
      const job = new TestDeclarativeJob();
      expect(job.id).toBe('declarative:test-declarative');
    });

    it('应该生成正确的 CronJobDefinition', () => {
      const job = new TestDeclarativeJob();
      const def = job.toDefinition();

      expect(def.id).toBe('declarative:test-declarative');
      expect(def.name).toBe('test-declarative');
      expect(def.description).toBe('测试用声明式 Job');
      expect(def.cronExpression).toBe('*/5 * * * *');
      expect(def.status).toBe('active');
      expect(def.source).toBe('declarative');
      expect(def.task).toBe('');
      expect(def.runCount).toBe(0);
      expect(def.failCount).toBe(0);
    });

    it('禁用的 Job 应该生成 paused 状态', () => {
      const job = new DisabledTestJob();
      const def = job.toDefinition();
      expect(def.status).toBe('paused');
    });
  });

  describe('CronJobExecutor - 声明式执行', () => {
    it('应该通过注册的实例执行声明式 Job', async () => {
      const job = new TestDeclarativeJob();
      executor.registerDeclarativeJob(job);

      const definition = job.toDefinition();
      await store.save(definition);

      await executor.execute(definition);

      expect(job.executeCalled).toBe(true);

      const updated = await store.get(definition.id);
      expect(updated).not.toBeNull();
      expect(updated!.runCount).toBe(1);
      expect(updated!.failCount).toBe(0);
      expect(updated!.lastRunAt).toBeTruthy();
    });

    it('声明式 Job 失败时应该记录错误', async () => {
      const job = new FailingJob();
      executor.registerDeclarativeJob(job);

      const definition = job.toDefinition();
      await store.save(definition);

      await executor.execute(definition);

      const updated = await store.get(definition.id);
      expect(updated!.failCount).toBe(1);
      expect(updated!.lastError).toContain('deliberate failure');
    });

    it('未注册的声明式 Job 应该抛出错误', async () => {
      const job = new TestDeclarativeJob();
      const definition = job.toDefinition();
      await store.save(definition);

      await executor.execute(definition);

      const executions = await store.getExecutions(definition.id);
      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe('failed');
      expect(executions[0].error).toContain('声明式 Job 实例未注册');
    });

    it('应该正确保存执行记录', async () => {
      const job = new TestDeclarativeJob();
      job.executeResult = '自定义结果';
      executor.registerDeclarativeJob(job);

      const definition = job.toDefinition();
      await store.save(definition);

      await executor.execute(definition);

      const executions = await store.getExecutions(definition.id);
      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe('success');
      expect(executions[0].result).toBe('自定义结果');
    });
  });
});
