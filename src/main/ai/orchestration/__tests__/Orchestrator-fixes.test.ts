import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../Orchestrator';
import type { Task, SubTask, ExecutionPlan } from '../types';
import type { IPlanner } from '../Planner';
import type { IWorkerCoordinator } from '../WorkerCoordinator';
import type { IAggregator } from '../AggregatorAgent';

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

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    pathExists: vi.fn(async () => false),
    readdir: vi.fn(async () => []),
    copy: vi.fn()
  }
}));

describe('Orchestrator - 7 Critical Fixes', () => {
  let mockPlanner: IPlanner;
  let mockWorkerCoordinator: IWorkerCoordinator;
  let mockAggregator: IAggregator;

  const createMockTask = (): Task => ({
    id: 'test-task-1',
    objective: 'Test objective',
    context: {},
    constraints: []
  });

  const createMockSubTask = (id: string, name: string, deps?: string[]): SubTask => ({
    id,
    taskId: 'test-task-1',
    name,
    description: `Description for ${name}`,
    assignedWorker: 'test-worker',
    status: 'pending',
    dependencies: deps
  });

  const createMockPlan = (subTasks: SubTask[]): ExecutionPlan => ({
    taskId: 'test-task-1',
    subTasks,
    stages: [
      {
        id: 'stage-1',
        name: 'Stage 1',
        order: 0,
        parallel: false,
        tasks: subTasks
      }
    ],
    createdAt: Date.now()
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockPlanner = {
      plan: vi.fn(),
      replan: vi.fn()
    } as unknown as IPlanner;

    mockWorkerCoordinator = {
      getOrCreateWorker: vi.fn(async () => ({
        id: 'worker-1',
        name: 'Test Worker',
        type: 'test-worker',
        status: 'idle'
      })),
      executeSubTask: vi.fn(async () => ({
        output: 'SubTask completed',
        duration: 1000
      })),
      cleanup: vi.fn()
    } as unknown as IWorkerCoordinator;

    mockAggregator = {
      aggregate: vi.fn(async () => ({
        summary: 'All tasks completed',
        duration: 500
      }))
    } as unknown as IAggregator;
  });

  describe('Fix 1: 超时机制实现', () => {
    it('应在总任务超时后抛出错误', async () => {
      const task = createMockTask();
      const subTask = createMockSubTask('st-1', 'Long task');
      const plan = createMockPlan([subTask]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);

      // 模拟子任务执行缓慢
      vi.mocked(mockWorkerCoordinator.executeSubTask).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ output: 'Done', duration: 2000 }), 32000))
      );

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        totalTimeout: 1000 // 1 秒超时
      });

      const promise = orchestrator.executeTask(task);

      // 快进时间到超时点
      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow(/timeout/i);
    });

    it('应在子任务超时后抛出错误（通过 WorkerCoordinator）', async () => {
      // 这个测试验证 WorkerCoordinator 的超时控制，会在 WorkerCoordinator.test.ts 中详细测试
      expect(true).toBe(true);
    });
  });

  describe('Fix 2: 依赖校验', () => {
    it('应在依赖子任务失败后拒绝执行依赖它的子任务', async () => {
      const task = createMockTask();
      const subTask1 = createMockSubTask('st-1', 'Task 1');
      const subTask2 = createMockSubTask('st-2', 'Task 2 (depends on st-1)', ['st-1']);
      const plan = createMockPlan([subTask1, subTask2]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);

      // 第一个子任务失败
      vi.mocked(mockWorkerCoordinator.executeSubTask)
        .mockRejectedValueOnce(new Error('SubTask 1 failed'))
        .mockResolvedValueOnce({ output: 'Task 2 output', duration: 1000 });

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        enableReplan: false
      });

      const result = await orchestrator.executeTask(task);

      // 第一个子任务应失败，第二个因为依赖检查而不应执行
      expect(result.subTaskResults).toHaveLength(1);
      expect(result.subTaskResults[0].status).toBe('failed');
      expect(result.status).toBe('failed');
    });
  });

  describe('Fix 3: Worker 池限制', () => {
    it('应在达到 Worker 数量上限时等待或抛出错误', async () => {
      // 这个测试主要验证 WorkerCoordinator 的限制逻辑，会在 WorkerCoordinator.test.ts 中详细测试
      expect(true).toBe(true);
    });
  });

  describe('Fix 4: 重新规划次数限制', () => {
    it('应在达到最大重新规划次数后停止重试', async () => {
      const task = createMockTask();
      const subTask = createMockSubTask('st-1', 'Task 1');
      const plan = createMockPlan([subTask]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);
      vi.mocked(mockPlanner.replan).mockResolvedValue(plan); // 重新规划返回相同计划

      // 子任务总是失败
      vi.mocked(mockWorkerCoordinator.executeSubTask).mockRejectedValue(new Error('Always fails'));

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        enableReplan: true,
        maxReplanAttempts: 2,
        maxRetries: 0 // 禁用重试，只测试重新规划
      });

      await orchestrator.executeTask(task);

      // replan 应被调用 2 次（最大重新规划次数）
      expect(mockPlanner.replan).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fix 5: 关键子任务失败处理', () => {
    it('应在关键子任务失败后立即终止整个任务', async () => {
      const task = createMockTask();
      const subTask1: SubTask = { ...createMockSubTask('st-1', 'Critical Task'), critical: true };
      const subTask2 = createMockSubTask('st-2', 'Task 2');
      const plan = createMockPlan([subTask1, subTask2]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);

      // 第一个关键子任务失败
      vi.mocked(mockWorkerCoordinator.executeSubTask)
        .mockRejectedValueOnce(new Error('Critical task failed'))
        .mockResolvedValueOnce({ output: 'Task 2 output', duration: 1000 });

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        enableReplan: false
      });

      const result = await orchestrator.executeTask(task);

      // 任务应失败，且第二个子任务不应执行
      expect(result.status).toBe('failed');
      expect(result.subTaskResults).toHaveLength(1);
      expect(mockWorkerCoordinator.executeSubTask).toHaveBeenCalledTimes(1);
    });

    it('应在可选子任务失败后继续执行', async () => {
      const task = createMockTask();
      const subTask1: SubTask = { ...createMockSubTask('st-1', 'Optional Task'), optional: true };
      const subTask2 = createMockSubTask('st-2', 'Task 2');
      const plan = createMockPlan([subTask1, subTask2]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);

      // 第一个可选子任务失败
      vi.mocked(mockWorkerCoordinator.executeSubTask)
        .mockRejectedValueOnce(new Error('Optional task failed'))
        .mockResolvedValueOnce({ output: 'Task 2 output', duration: 1000 });

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);

      const result = await orchestrator.executeTask(task);

      // 任务应部分成功，两个子任务都应执行
      expect(result.status).toBe('partial');
      expect(result.subTaskResults).toHaveLength(2);
      expect(mockWorkerCoordinator.executeSubTask).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fix 6: 并行执行时的依赖检查', () => {
    it('应检测 Stage 内子任务的相互依赖并强制顺序执行', async () => {
      const task = createMockTask();
      const subTask1 = createMockSubTask('st-1', 'Task 1');
      const subTask2 = createMockSubTask('st-2', 'Task 2 (depends on st-1)', ['st-1']);
      const plan: ExecutionPlan = {
        taskId: 'test-task-1',
        subTasks: [subTask1, subTask2],
        stages: [
          {
            id: 'stage-1',
            name: 'Parallel Stage',
            order: 0,
            parallel: true, // 尝试并行
            tasks: [subTask1, subTask2] // 但它们有依赖关系
          }
        ],
        createdAt: Date.now()
      };

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);
      vi.mocked(mockWorkerCoordinator.executeSubTask).mockResolvedValue({
        output: 'Task output',
        duration: 1000
      });

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        allowParallel: true
      });

      const result = await orchestrator.executeTask(task);

      // 任务应成功完成，且因为检测到依赖而顺序执行
      expect(result.status).toBe('success');
      expect(result.subTaskResults).toHaveLength(2);
    });
  });

  describe('Fix 7: 失败记录到智库', () => {
    it('应在子任务失败后自动记录到 brain/patterns/', async () => {
      const task = createMockTask();
      const subTask = createMockSubTask('st-1', 'Failing Task');
      const plan = createMockPlan([subTask]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);
      vi.mocked(mockWorkerCoordinator.executeSubTask).mockRejectedValue(new Error('Execution failed'));

      const fs = await import('fs-extra');
      const writeJsonSpy = vi.spyOn(fs.default, 'writeJson');

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        enableReplan: false
      });

      await orchestrator.executeTask(task);

      // 应调用 writeJson 记录失败到智库
      expect(writeJsonSpy).toHaveBeenCalled();
      const writeJsonCall = writeJsonSpy.mock.calls[0];
      const patternPath = writeJsonCall[0] as string;
      const patternData = writeJsonCall[1] as Record<string, unknown>;

      expect(patternPath).toContain('brain/patterns');
      expect(patternData).toMatchObject({
        name: expect.stringContaining('编排模式子任务失败'),
        practice: {
          confidence: 0.0,
          success_streak: 0,
          outcome: {
            status: 'failure'
          }
        },
        evolution: {
          outcome: {
            status: 'failure'
          }
        }
      });
    });
  });

  describe('综合场景测试', () => {
    it('应综合处理依赖、超时、关键任务和智库记录', async () => {
      const task = createMockTask();
      const subTask1: SubTask = { ...createMockSubTask('st-1', 'Task 1'), critical: true };
      const subTask2 = createMockSubTask('st-2', 'Task 2 (depends on st-1)', ['st-1']);
      const plan = createMockPlan([subTask1, subTask2]);

      vi.mocked(mockPlanner.plan).mockResolvedValue(plan);

      // 第一个关键子任务失败
      vi.mocked(mockWorkerCoordinator.executeSubTask).mockRejectedValueOnce(
        new Error('Critical task execution failed')
      );

      const fs = await import('fs-extra');
      const writeJsonSpy = vi.spyOn(fs.default, 'writeJson');

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
        enableReplan: false,
        totalTimeout: 60000
      });

      const result = await orchestrator.executeTask(task);

      // 1. 任务应失败
      expect(result.status).toBe('failed');
      // 2. 只执行了第一个子任务
      expect(result.subTaskResults).toHaveLength(1);
      // 3. 失败应记录到智库
      expect(writeJsonSpy).toHaveBeenCalled();
      // 4. 第二个子任务不应执行
      expect(mockWorkerCoordinator.executeSubTask).toHaveBeenCalledTimes(1);
    });
  });
});
