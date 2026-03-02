import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CronJobStore } from '../CronJobStore';
import { CronJobExecutor } from '../CronJobExecutor';
import { CronScheduler } from '../CronScheduler';
import { BaseCronJob } from '../types';
import type { CronJobContext, CronJobDefinition } from '../types';

const mockEnvPaths = vi.hoisted(() => ({
  workersDir: '',
  builtinExtensionsDir: '',
  userExtensionsDir: '',
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

describe('External CronJob (cron-job.json)', () => {
  let tempDir: string;
  let workersDir: string;
  let extensionsDir: string;
  let store: CronJobStore;
  let executor: CronJobExecutor;
  let scheduler: CronScheduler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-external-'));
    workersDir = path.join(tempDir, 'workers');
    extensionsDir = path.join(tempDir, 'extensions');

    await fs.mkdir(workersDir, { recursive: true });
    await fs.mkdir(extensionsDir, { recursive: true });

    mockEnvPaths.userHome = tempDir;
    mockEnvPaths.workersDir = workersDir;
    mockEnvPaths.builtinExtensionsDir = extensionsDir;
    mockEnvPaths.userExtensionsDir = path.join(tempDir, 'user-extensions');

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
    if (scheduler) await scheduler.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('应该从 workers 目录扫描 cron-job.json', async () => {
    const tavernDir = path.join(workersDir, 'tavern');
    fsSync.mkdirSync(tavernDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(tavernDir, 'cron-job.json'),
      JSON.stringify({
        name: 'tavern-sync',
        description: '定时同步酒馆数据',
        cronExpression: '0 */6 * * *',
        task: '请同步酒馆最新数据到本地缓存',
        agentId: 'app-copilot',
        enabled: true
      })
    );

    // 直接调用 loadExternalJobs（通过 start，但 mock 了 scanCronJobs 返回空）
    await scheduler.start();

    const allJobs = await store.list();
    const externalJob = allJobs.find((j: CronJobDefinition) => j.source === 'external');
    expect(externalJob).toBeDefined();
    expect(externalJob!.name).toBe('tavern-sync');
    expect(externalJob!.task).toBe('请同步酒馆最新数据到本地缓存');
    expect(externalJob!.agentId).toBe('app-copilot');
    expect(externalJob!.id).toBe('external:tavern:tavern-sync');
  });

  it('应该跳过 enabled=false 的外部 Job', async () => {
    const disabledDir = path.join(workersDir, 'disabled-worker');
    fsSync.mkdirSync(disabledDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(disabledDir, 'cron-job.json'),
      JSON.stringify({
        name: 'disabled-job',
        description: '已禁用的 Job',
        cronExpression: '0 * * * *',
        task: '这个不应该被调度',
        enabled: false
      })
    );

    await scheduler.start();

    const allJobs = await store.list();
    const externalJob = allJobs.find((j: CronJobDefinition) => j.id === 'external:disabled-worker:disabled-job');
    expect(externalJob).toBeDefined();
    expect(externalJob!.status).toBe('paused');
  });

  it('应该跳过无效 cron 表达式的外部 Job', async () => {
    const badDir = path.join(workersDir, 'bad-cron');
    fsSync.mkdirSync(badDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(badDir, 'cron-job.json'),
      JSON.stringify({
        name: 'bad-cron-job',
        description: '无效 cron',
        cronExpression: 'not a cron',
        task: 'should fail validation'
      })
    );

    await scheduler.start();

    const allJobs = await store.list();
    const badJob = allJobs.find((j: CronJobDefinition) => j.name === 'bad-cron-job');
    expect(badJob).toBeUndefined();
  });

  it('应该跳过缺少必要字段的外部 Job', async () => {
    const incompleteDir = path.join(workersDir, 'incomplete');
    fsSync.mkdirSync(incompleteDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(incompleteDir, 'cron-job.json'),
      JSON.stringify({
        name: 'no-task-job',
        cronExpression: '* * * * *'
      })
    );

    await scheduler.start();

    const allJobs = await store.list();
    const incompleteJob = allJobs.find((j: CronJobDefinition) => j.name === 'no-task-job');
    expect(incompleteJob).toBeUndefined();
  });

  it('应该忽略不存在的扫描目录', async () => {
    await fs.rm(workersDir, { recursive: true, force: true });
    await fs.rm(extensionsDir, { recursive: true, force: true });

    await expect(scheduler.start()).resolves.not.toThrow();
  });
});
