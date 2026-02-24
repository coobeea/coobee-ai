/**
 * Orchestrator Worker Skill 注入集成测试
 *
 * 验证 WorkerCoordinator 的 createWorkerRuntime()
 * 调用 injectEnv() 为每个 Worker 注入 Skill 和执行协议
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

const mockInjectEnv = vi.fn().mockResolvedValue('/mock/workspace');
vi.mock('@main/ai/AgentEnvInjector', () => ({
  injectEnv: (...args: unknown[]) => mockInjectEnv(...args)
}));

const mockRunFn = vi.fn().mockResolvedValue({ output: 'task completed', chunks: [] });
const mockDestroyFn = vi.fn().mockResolvedValue(undefined);
const mockBuild = vi.fn().mockResolvedValue({
  run: mockRunFn,
  stream: vi.fn(),
  destroy: mockDestroyFn
});

const mockBuilder = {
  name: vi.fn().mockReturnThis(),
  mode: vi.fn().mockReturnThis(),
  sessionMode: vi.fn().mockReturnThis(),
  instructions: vi.fn().mockReturnThis(),
  sessionId: vi.fn().mockReturnThis(),
  model: vi.fn().mockReturnThis(),
  tools: vi.fn().mockReturnThis(),
  build: mockBuild,
  getMode: vi.fn().mockReturnValue('agent')
};

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    piMono: vi.fn().mockReturnValue(mockBuilder)
  }
}));

vi.mock('@main/ai/agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null)
    })
  }
}));

import { WorkerCoordinator } from '../WorkerCoordinator';
import type { SubTask } from '../types';

function makeSubTask(overrides: Partial<SubTask> & { id: string; name: string }): SubTask {
  return {
    taskId: 'parent-task',
    description: overrides.name,
    assignedWorker: 'default-worker',
    status: 'pending' as const,
    ...overrides
  };
}

describe('Orchestrator Worker Skill 注入测试', () => {
  let coordinator: WorkerCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = new WorkerCoordinator({
      parentSessionId: 'test-orchestration',
      model: 'test-model'
    });
  });

  it('executeSubTask 应为 Worker 调用 injectEnv', async () => {
    const worker = await coordinator.getOrCreateWorker('code');

    await coordinator.executeSubTask(
      makeSubTask({
        id: 'task-1',
        name: 'Write hello.py',
        description: 'Create a Python hello world script',
        assignedWorker: worker.id
      }),
      worker
    );

    expect(mockInjectEnv).toHaveBeenCalledTimes(1);
    const [sessionId, builder] = mockInjectEnv.mock.calls[0];
    expect(sessionId).toContain('test-orchestration:worker:task-1');
    expect(builder).toBe(mockBuilder);
  });

  it('Worker Runtime 应使用 mode("agent")', async () => {
    const worker = await coordinator.getOrCreateWorker('general');

    await coordinator.executeSubTask(makeSubTask({ id: 'task-2', name: 'Research topic' }), worker);

    expect(mockBuilder.mode).toHaveBeenCalledWith('agent');
  });

  it('Worker Runtime 应在执行完后被销毁', async () => {
    const worker = await coordinator.getOrCreateWorker('review');

    await coordinator.executeSubTask(makeSubTask({ id: 'task-3', name: 'Review code' }), worker);

    expect(mockDestroyFn).toHaveBeenCalledTimes(1);
  });

  it('executeSubTask 完成后 Worker 状态应恢复为 idle', async () => {
    const worker = await coordinator.getOrCreateWorker('code');
    expect(worker.status).toBe('idle');

    const result = await coordinator.executeSubTask(makeSubTask({ id: 'task-4', name: 'Task 4' }), worker);

    expect(result.output).toBe('task completed');
    expect(worker.status).toBe('idle');
    expect(worker.currentTaskId).toBeUndefined();
  });

  it('executeSubTask 失败后 Worker 状态也应恢复为 idle', async () => {
    mockRunFn.mockRejectedValueOnce(new Error('LLM error'));
    const worker = await coordinator.getOrCreateWorker('code');

    await expect(
      coordinator.executeSubTask(makeSubTask({ id: 'task-5', name: 'Failing task' }), worker)
    ).rejects.toThrow('LLM error');

    expect(worker.status).toBe('idle');
  });

  it('injectEnv 应在 build 之前调用', async () => {
    const callOrder: string[] = [];
    mockInjectEnv.mockImplementation(async () => {
      callOrder.push('injectEnv');
      return '/mock/workspace';
    });
    mockBuild.mockImplementation(async () => {
      callOrder.push('build');
      return { run: mockRunFn, stream: vi.fn(), destroy: mockDestroyFn };
    });

    const worker = await coordinator.getOrCreateWorker('code');
    await coordinator.executeSubTask(makeSubTask({ id: 'task-6', name: 'Order test' }), worker);

    expect(callOrder).toEqual(['injectEnv', 'build']);
  });

  it('不同类型的 Worker 都应获得 injectEnv 注入', async () => {
    for (const type of ['code', 'research', 'review', 'general']) {
      vi.clearAllMocks();
      const w = await coordinator.getOrCreateWorker(type);
      await coordinator.executeSubTask(makeSubTask({ id: `task-${type}`, name: `${type} task` }), w);
      expect(mockInjectEnv).toHaveBeenCalledTimes(1);
      expect(mockBuilder.mode).toHaveBeenCalledWith('agent');
    }
  });

  it('clear 应清理所有 Workers', async () => {
    await coordinator.getOrCreateWorker('code');
    await coordinator.getOrCreateWorker('research');

    await coordinator.clear();

    expect(coordinator.getWorkerStatus('worker-code-1')).toBeNull();
    expect(coordinator.getWorkerStatus('worker-research-2')).toBeNull();
  });
});
