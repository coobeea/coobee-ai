import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CronJobStore } from '../CronJobStore';
import { CronJobExecutor } from '../CronJobExecutor';
import { BaseCronJob } from '../types';
import type { CronJobContext } from '../types';
import { ExtensionRegistry } from '@main/common/extension/ExtensionRegistry';

const mockEnvPaths = vi.hoisted(() => ({
  userHome: ''
}));

vi.mock('@main/ai/AgentExecutor', () => ({
  getAgentExecutor: vi.fn()
}));

vi.mock('@main/common/scan', () => ({
  scanCronJobs: vi.fn(() => [])
}));

vi.mock('@main/common/env', () => ({
  Env: {
    paths: mockEnvPaths
  }
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
    mockEnvPaths.userHome = tempDir;

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

describe('Extension CronJob 注册', () => {
  let registry: ExtensionRegistry;

  beforeEach(() => {
    registry = new ExtensionRegistry();
  });

  it('应该注册 Extension CronJob', () => {
    registry.registerCronJob('tavern-integration', {
      name: 'tavern-sync',
      description: '定时同步酒馆数据',
      cronExpression: '0 */6 * * *',
      task: '请同步酒馆最新数据到本地缓存',
      agentId: 'app-copilot'
    });

    const jobs = registry.getCronJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].extensionId).toBe('tavern-integration');
    expect(jobs[0].config.name).toBe('tavern-sync');
    expect(jobs[0].config.task).toBe('请同步酒馆最新数据到本地缓存');
  });

  it('同一 Extension 不能注册重名 Job', () => {
    registry.registerCronJob('my-ext', {
      name: 'job-a',
      description: 'test',
      cronExpression: '* * * * *',
      task: 'do something'
    });

    expect(() =>
      registry.registerCronJob('my-ext', {
        name: 'job-a',
        description: 'duplicate',
        cronExpression: '* * * * *',
        task: 'do something else'
      })
    ).toThrow('already registered');
  });

  it('不同 Extension 可以注册同名 Job', () => {
    registry.registerCronJob('ext-a', {
      name: 'sync',
      description: 'sync a',
      cronExpression: '* * * * *',
      task: 'sync a'
    });

    registry.registerCronJob('ext-b', {
      name: 'sync',
      description: 'sync b',
      cronExpression: '* * * * *',
      task: 'sync b'
    });

    expect(registry.getCronJobs().length).toBe(2);
  });

  it('卸载 Extension 时应清除其 CronJob', () => {
    registry.registerCronJob('ext-a', {
      name: 'job-1',
      description: 'test',
      cronExpression: '* * * * *',
      task: 'task 1'
    });
    registry.registerCronJob('ext-b', {
      name: 'job-2',
      description: 'test',
      cronExpression: '* * * * *',
      task: 'task 2'
    });

    const removed = registry.unregisterCronJobsByExtension('ext-a');
    expect(removed).toEqual(['job-1']);
    expect(registry.getCronJobs().length).toBe(1);
    expect(registry.getCronJobs()[0].extensionId).toBe('ext-b');
  });

  it('unregisterAll 应包含 CronJob 清理', () => {
    registry.registerCronJob('ext-a', {
      name: 'job-x',
      description: 'test',
      cronExpression: '* * * * *',
      task: 'task x'
    });

    registry.unregisterAll('ext-a');
    expect(registry.getCronJobs().length).toBe(0);
  });

  it('getExtensionIds 应包含 CronJob 注册者', () => {
    registry.registerCronJob('cron-only-ext', {
      name: 'my-job',
      description: 'test',
      cronExpression: '* * * * *',
      task: 'my task'
    });

    expect(registry.getExtensionIds()).toContain('cron-only-ext');
  });

  it('clear 应清除所有 CronJob', () => {
    registry.registerCronJob('ext-a', {
      name: 'j1',
      description: 'test',
      cronExpression: '* * * * *',
      task: 't1'
    });
    registry.registerCronJob('ext-b', {
      name: 'j2',
      description: 'test',
      cronExpression: '* * * * *',
      task: 't2'
    });

    registry.clear();
    expect(registry.getCronJobs().length).toBe(0);
  });
});
