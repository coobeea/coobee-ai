/**
 * ConcurrencyManager 测试
 *
 * SDK 无关 — 使用 AgentRuntime mock 替代 SDK Agent/run
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

import { ConcurrencyManager, type SwarmSubTask } from '../ConcurrencyManager';
import type { SwarmConfig } from '../types';
import type { AgentRuntime } from '../../runtime/AgentRuntime';

const config: SwarmConfig = {
  id: 'test',
  name: 'Test',
  maxConcurrentAgents: 3,
  agentIdleTimeout: 60000,
  maxHandoffDepth: 5,
  enableSharedContext: true,
  enableMonitoring: true
};

function createMockRuntime(output: string = 'result'): AgentRuntime {
  return {
    run: vi.fn().mockResolvedValue({ output, toolCalls: [], duration: 10 }),
    destroy: vi.fn().mockResolvedValue(undefined)
  } as unknown as AgentRuntime;
}

function createFailingRuntime(error: string = 'fail'): AgentRuntime {
  return {
    run: vi.fn().mockRejectedValue(new Error(error)),
    destroy: vi.fn().mockResolvedValue(undefined)
  } as unknown as AgentRuntime;
}

describe('ConcurrencyManager', () => {
  let manager: ConcurrencyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConcurrencyManager(config);
  });

  describe('buildExecutionPhases', () => {
    it('无依赖任务放在一个阶段', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'task 1', roleId: 'coder' },
        { id: 't2', input: 'task 2', roleId: 'reviewer' }
      ];
      const phases = manager.buildExecutionPhases(tasks);
      expect(phases).toHaveLength(1);
      expect(phases[0]).toHaveLength(2);
    });

    it('有依赖的任务分阶段', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'write code', roleId: 'coder' },
        { id: 't2', input: 'review code', roleId: 'reviewer', dependencies: ['t1'] },
        { id: 't3', input: 'test code', roleId: 'tester', dependencies: ['t1'] },
        { id: 't4', input: 'deploy', roleId: 'deployer', dependencies: ['t2', 't3'] }
      ];
      const phases = manager.buildExecutionPhases(tasks);
      expect(phases).toHaveLength(3);
      expect(phases[0]).toHaveLength(1);
      expect(phases[1]).toHaveLength(2);
      expect(phases[2]).toHaveLength(1);
    });

    it('循环依赖强制执行', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'a', roleId: 'r1', dependencies: ['t2'] },
        { id: 't2', input: 'b', roleId: 'r2', dependencies: ['t1'] }
      ];
      const phases = manager.buildExecutionPhases(tasks);
      expect(phases.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('executeParallel', () => {
    it('按阶段执行并聚合结果', async () => {
      const runtimes = new Map<string, AgentRuntime>();
      runtimes.set('coder', createMockRuntime('code done'));
      runtimes.set('reviewer', createMockRuntime('review done'));

      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'code', roleId: 'coder' },
        { id: 't2', input: 'review', roleId: 'reviewer', dependencies: ['t1'] }
      ];

      const result = await manager.executeParallel(tasks, runtimes);
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.failCount).toBe(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.aggregatedOutput).toContain('coder');
    });

    it('缺少 Runtime 时记录失败', async () => {
      const runtimes = new Map<string, AgentRuntime>();

      const tasks: SwarmSubTask[] = [{ id: 't1', input: 'task', roleId: 'missing' }];

      const result = await manager.executeParallel(tasks, runtimes);
      expect(result.failCount).toBe(1);
      expect(result.results[0].error).toContain('AgentRuntime not found');
    });

    it('Runtime 执行失败不影响其他', async () => {
      const runtimes = new Map<string, AgentRuntime>();
      runtimes.set('r1', createMockRuntime('ok'));
      runtimes.set('r2', createFailingRuntime('boom'));

      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'a', roleId: 'r1' },
        { id: 't2', input: 'b', roleId: 'r2' }
      ];

      const result = await manager.executeParallel(tasks, runtimes);
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(1);
      expect(result.failCount).toBe(1);
      expect(result.results.find((r) => !r.success)?.error).toContain('boom');
    });
  });

  describe('状态查询', () => {
    it('getRunningCount 初始为 0', () => {
      expect(manager.getRunningCount()).toBe(0);
    });

    it('isAtCapacity 初始为 false', () => {
      expect(manager.isAtCapacity()).toBe(false);
    });
  });

  describe('事件系统', () => {
    it('addEventListener 接收事件', async () => {
      const listener = vi.fn();
      manager.addEventListener(listener);

      const runtimes = new Map<string, AgentRuntime>();
      runtimes.set('r1', createMockRuntime());

      await manager.executeParallel([{ id: 't1', input: 'a', roleId: 'r1' }], runtimes);

      expect(listener).toHaveBeenCalled();
      const events = listener.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
      expect(events).toContain('task_started');
      expect(events).toContain('task_completed');
      expect(events).toContain('phase_started');
      expect(events).toContain('all_completed');
    });
  });

  describe('destroy', () => {
    it('清理资源', () => {
      manager.destroy();
      expect(manager.getRunningCount()).toBe(0);
    });
  });
});
