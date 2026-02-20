/**
 * WorkerCoordinator 测试
 *
 * 测试 Worker 协调器的核心功能：
 * - 获取或创建 Worker
 * - Worker 复用（空闲 Worker 匹配）
 * - 执行子任务
 * - Worker 状态管理
 * - 清理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Mock 依赖 =====
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const mockRunResult = vi.fn();
const mockDestroyResult = vi.fn();

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: {
    piMono: () => {
      const builder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        sessionId: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis(),
        build: vi.fn().mockResolvedValue({
          run: (prompt: string) => mockRunResult(prompt),
          destroy: () => mockDestroyResult()
        })
      };
      return builder;
    }
  }
}));

// Mock AgentStore (optional, for agent-definition-based workers)
vi.mock('../../storage/AgentConfigStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null)
    })
  }
}));

import { WorkerCoordinator } from '../WorkerCoordinator';
import type { SubTask } from '../types';

function createSubTask(overrides?: Partial<SubTask>): SubTask {
  return {
    id: 'st-1',
    taskId: 'task-1',
    name: 'Test subtask',
    description: 'Do something',
    dependencies: [],
    assignedWorker: 'code',
    status: 'pending',
    ...overrides
  };
}

describe('WorkerCoordinator', () => {
  let coordinator: WorkerCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunResult.mockResolvedValue({ output: 'task completed' });
    mockDestroyResult.mockResolvedValue(undefined);
    coordinator = new WorkerCoordinator();
  });

  // ===== getOrCreateWorker =====

  describe('getOrCreateWorker', () => {
    it('创建新的 Worker', async () => {
      const worker = await coordinator.getOrCreateWorker('code');

      expect(worker.id).toContain('worker-code-');
      expect(worker.type).toBe('code');
      expect(worker.status).toBe('idle');
    });

    it('复用空闲的 Worker', async () => {
      const worker1 = await coordinator.getOrCreateWorker('general');
      const worker2 = await coordinator.getOrCreateWorker('general');

      // 第一个 Worker 空闲，应该复用
      expect(worker1.id).toBe(worker2.id);
    });

    it('不复用忙碌的 Worker', async () => {
      const worker1 = await coordinator.getOrCreateWorker('code');
      worker1.status = 'busy';

      const worker2 = await coordinator.getOrCreateWorker('code');

      expect(worker1.id).not.toBe(worker2.id);
    });
  });

  // ===== executeSubTask =====

  describe('executeSubTask', () => {
    it('成功执行子任务', async () => {
      const worker = await coordinator.getOrCreateWorker('code');
      const subTask = createSubTask();

      const result = await coordinator.executeSubTask(subTask, worker);

      expect(result.output).toBe('task completed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      // 执行后 Worker 恢复空闲
      expect(worker.status).toBe('idle');
    });

    it('执行中 Worker 状态为 busy', async () => {
      let capturedStatus = '';
      mockRunResult.mockImplementation(async () => {
        const w = coordinator.getWorkerStatus('worker-code-1');
        capturedStatus = w?.status || '';
        return { output: 'done' };
      });

      const worker = await coordinator.getOrCreateWorker('code');
      await coordinator.executeSubTask(createSubTask(), worker);

      expect(capturedStatus).toBe('busy');
    });

    it('执行失败时 Worker 状态恢复为 idle（防止泄漏）', async () => {
      mockRunResult.mockRejectedValue(new Error('execution failed'));

      const worker = await coordinator.getOrCreateWorker('code');

      await expect(coordinator.executeSubTask(createSubTask(), worker)).rejects.toThrow('execution failed');

      expect(worker.status).toBe('idle');
    });

    it('构建包含依赖信息的提示词', async () => {
      const worker = await coordinator.getOrCreateWorker('code');
      const subTask = createSubTask({
        name: 'Implement feature',
        description: 'Build the login page',
        dependencies: ['subtask-1', 'subtask-2']
      });

      await coordinator.executeSubTask(subTask, worker);

      const prompt = mockRunResult.mock.calls[0][0];
      expect(prompt).toContain('Implement feature');
      expect(prompt).toContain('Build the login page');
      expect(prompt).toContain('subtask-1');
      expect(prompt).toContain('subtask-2');
    });

    it('每次执行创建新的 Runtime 并销毁', async () => {
      const worker = await coordinator.getOrCreateWorker('code');
      await coordinator.executeSubTask(createSubTask(), worker);

      // destroy 应该被调用
      expect(mockDestroyResult).toHaveBeenCalled();
    });
  });

  // ===== getWorkerStatus =====

  describe('getWorkerStatus', () => {
    it('获取已创建的 Worker 状态', async () => {
      const worker = await coordinator.getOrCreateWorker('code');
      const status = coordinator.getWorkerStatus(worker.id);

      expect(status).toEqual(worker);
    });

    it('不存在返回 null', () => {
      expect(coordinator.getWorkerStatus('nope')).toBeNull();
    });
  });

  // ===== clear =====

  describe('clear', () => {
    it('清理所有 Worker', async () => {
      const worker = await coordinator.getOrCreateWorker('code');

      await coordinator.clear();

      expect(coordinator.getWorkerStatus(worker.id)).toBeNull();
    });

    it('清理后计数器重置', async () => {
      await coordinator.getOrCreateWorker('code');
      await coordinator.clear();

      const worker = await coordinator.getOrCreateWorker('code');
      expect(worker.id).toBe('worker-code-1');
    });
  });
});
