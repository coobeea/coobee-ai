import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerCoordinator } from '../WorkerCoordinator';
import type { SubTask } from '../types';

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@main/common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn(async (id: string) => `/tmp/test-workspace/${id}`),
    getRootDir: vi.fn(async () => '/tmp/test-root')
  }
}));

vi.mock('@main/ai/runtime/pimono/PiMonoBuilder', () => ({
  PiMonoBuilder: vi.fn().mockImplementation(() => ({
    withAgentId: vi.fn().mockReturnThis(),
    withModel: vi.fn().mockReturnThis(),
    withWorkspaceRoot: vi.fn().mockReturnThis(),
    build: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({ output: 'Mocked output', duration: 100 }),
      destroy: vi.fn().mockResolvedValue(undefined)
    })
  }))
}));

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    pathExists: vi.fn(async () => false),
    readdir: vi.fn(async () => []),
    copy: vi.fn()
  }
}));

describe('WorkerCoordinator - Fixes', () => {
  const createMockSubTask = (id: string, name: string): SubTask => ({
    id,
    taskId: 'test-task',
    name,
    description: `Description for ${name}`,
    assignedWorker: 'test-worker',
    status: 'pending'
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('Fix 3: Worker 池限制', () => {
    it('应在达到总 Worker 数量上限时等待空闲 Worker', async () => {
      const coordinator = new WorkerCoordinator({
        maxTotalWorkers: 2,
        maxWorkersPerType: 5
      });

      // 创建 2 个 Worker（达到上限）
      const worker1 = await coordinator.getOrCreateWorker('type-a');
      const worker2 = await coordinator.getOrCreateWorker('type-b');

      expect(worker1.id).toBe('worker-type-a-1');
      expect(worker2.id).toBe('worker-type-b-2');

      // 尝试创建第 3 个 Worker，应该等待
      const createPromise = coordinator.getOrCreateWorker('type-c');

      // 由于没有 Worker 变为空闲，应该在 30 秒后超时
      vi.advanceTimersByTime(31000);

      await expect(createPromise).rejects.toThrow(/Max total workers/);
    });

    it('应在达到同类型 Worker 数量上限时等待相同类型的空闲 Worker', async () => {
      const coordinator = new WorkerCoordinator({
        maxTotalWorkers: 10,
        maxWorkersPerType: 2
      });

      // 创建 2 个相同类型的 Worker（达到同类型上限）
      const worker1 = await coordinator.getOrCreateWorker('type-a');
      const worker2 = await coordinator.getOrCreateWorker('type-a');

      expect(worker1.id).toBe('worker-type-a-1');
      expect(worker2.id).toBe('worker-type-a-2');

      // 尝试创建第 3 个相同类型的 Worker，应该等待
      const createPromise = coordinator.getOrCreateWorker('type-a');

      vi.advanceTimersByTime(31000);

      await expect(createPromise).rejects.toThrow(/Max workers per type/);
    });
  });

  describe('Fix 1 (子任务超时): executeSubTask 超时控制', () => {
    it('应在子任务执行超时后抛出错误', async () => {
      const coordinator = new WorkerCoordinator({
        executionTimeout: 2000 // 2 秒超时
      });

      const worker = await coordinator.getOrCreateWorker('test-worker');
      const subTask = createMockSubTask('st-1', 'Slow task');

      // Mock runtime.run 模拟缓慢任务
      const { PiMonoBuilder } = await import('@main/ai/runtime/pimono/PiMonoBuilder');
      const mockBuilder = new PiMonoBuilder();
      const mockRuntime = await mockBuilder.build();
      vi.mocked(mockRuntime.run).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ output: 'Done', duration: 5000 }), 5000))
      );

      const executePromise = coordinator.executeSubTask(subTask, worker);

      // 快进到超时点
      vi.advanceTimersByTime(2001);

      await expect(executePromise).rejects.toThrow(/timeout/i);
    });
  });
});
