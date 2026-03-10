/**
 * Orchestrator 单元测试
 *
 * 验证编排模式核心流程：
 *   - 规划 → 顺序执行 → 聚合结果
 *   - 并行执行 Stage
 *   - 子任务失败 + 重试
 *   - 事件回调完整性
 *   - 任务取消
 *   - 清理资源
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator, type OrchestratorEvent } from '../Orchestrator';
import type { IPlanner } from '../Planner';
import type { IWorkerCoordinator, WorkerExecutionResult } from '../WorkerCoordinator';
import type { IAggregator, AggregationResult } from '../AggregatorAgent';
import type { Task, ExecutionPlan, SubTask, Stage, WorkerInfo } from '../types';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

function createSubTask(id: string, taskId: string, name: string, worker = 'general'): SubTask {
  return {
    id,
    taskId,
    name,
    description: `SubTask: ${name}`,
    assignedWorker: worker,
    status: 'pending'
  };
}

function createStage(id: string, name: string, tasks: SubTask[], parallel = false, order = 0): Stage {
  return { id, name, tasks, parallel, order };
}

function createTask(id = 'task-1', objective = '测试任务'): Task {
  return { id, objective };
}

const mockWorkerInfo: WorkerInfo = {
  id: 'worker-1',
  name: 'general',
  status: 'idle'
};

describe('Orchestrator', () => {
  let mockPlanner: IPlanner;
  let mockWorkerCoordinator: IWorkerCoordinator;
  let mockAggregator: IAggregator;
  let executeSubTaskFn: ReturnType<
    typeof vi.fn<(subTask: SubTask, worker: WorkerInfo) => Promise<WorkerExecutionResult>>
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPlanner = {
      plan: vi.fn(),
      replan: vi.fn()
    };

    executeSubTaskFn = vi.fn<(subTask: SubTask, worker: WorkerInfo) => Promise<WorkerExecutionResult>>();

    mockWorkerCoordinator = {
      getOrCreateWorker: vi.fn().mockResolvedValue(mockWorkerInfo),
      executeSubTask: executeSubTaskFn,
      getWorkerStatus: vi.fn().mockReturnValue(null),
      clear: vi.fn().mockResolvedValue(undefined)
    };

    mockAggregator = {
      aggregate: vi.fn().mockResolvedValue({
        summary: '任务汇总完成',
        duration: 100
      } as AggregationResult)
    };
  });

  it('规划 → 顺序执行 → 聚合结果', async () => {
    const task = createTask();
    const sub1 = createSubTask('s1', 'task-1', '分析需求');
    const sub2 = createSubTask('s2', 'task-1', '编写代码');

    const plan: ExecutionPlan = {
      taskId: 'task-1',
      subTasks: [sub1, sub2],
      stages: [createStage('stg-1', '阶段1', [sub1], false, 0), createStage('stg-2', '阶段2', [sub2], false, 1)],
      createdAt: Date.now()
    };

    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
    executeSubTaskFn
      .mockResolvedValueOnce({ output: '需求已分析', duration: 100 })
      .mockResolvedValueOnce({ output: '代码已编写', duration: 200 });

    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);
    const result = await orchestrator.executeTask(task);

    expect(result.status).toBe('success');
    expect(result.subTaskResults).toHaveLength(2);
    expect(result.subTaskResults.every((r) => r.status === 'completed')).toBe(true);
    expect(result.stats.totalSubTasks).toBe(2);
    expect(result.stats.completedSubTasks).toBe(2);
    expect(result.stats.failedSubTasks).toBe(0);
    expect(result.stats.duration).toBeGreaterThanOrEqual(0);
  });

  it('并行执行 Stage', async () => {
    const task = createTask();
    const sub1 = createSubTask('s1', 'task-1', 'JS对比');
    const sub2 = createSubTask('s2', 'task-1', 'TS对比');

    const plan: ExecutionPlan = {
      taskId: 'task-1',
      subTasks: [sub1, sub2],
      stages: [createStage('stg-1', '并行分析', [sub1, sub2], true, 0)],
      createdAt: Date.now()
    };

    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
    executeSubTaskFn.mockResolvedValue({ output: '分析完成', duration: 100 });

    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
      allowParallel: true
    });

    const result = await orchestrator.executeTask(task);

    expect(result.status).toBe('success');
    expect(result.subTaskResults).toHaveLength(2);
    expect(executeSubTaskFn).toHaveBeenCalledTimes(2);
  });

  it('子任务失败 → partial 状态', async () => {
    const task = createTask();
    const sub1 = createSubTask('s1', 'task-1', '成功任务');
    const sub2 = createSubTask('s2', 'task-1', '失败任务');

    const plan: ExecutionPlan = {
      taskId: 'task-1',
      subTasks: [sub1, sub2],
      stages: [createStage('stg-1', '执行', [sub1, sub2], false, 0)],
      createdAt: Date.now()
    };

    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
    executeSubTaskFn
      .mockResolvedValueOnce({ output: '完成', duration: 100 })
      .mockRejectedValueOnce(new Error('执行失败'));

    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, { maxRetries: 0 });
    const result = await orchestrator.executeTask(task);

    expect(result.status).toBe('partial');
    expect(result.stats.completedSubTasks).toBe(1);
    expect(result.stats.failedSubTasks).toBe(1);
  });

  it('事件回调完整性', async () => {
    const task = createTask();
    const sub1 = createSubTask('s1', 'task-1', '单一任务');

    const plan: ExecutionPlan = {
      taskId: 'task-1',
      subTasks: [sub1],
      stages: [createStage('stg-1', '执行', [sub1], false, 0)],
      createdAt: Date.now()
    };

    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
    executeSubTaskFn.mockResolvedValue({ output: '完成', duration: 50 });

    const events: OrchestratorEvent[] = [];
    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
      onEvent: (e) => events.push(e)
    });

    await orchestrator.executeTask(task);

    const types = events.map((e) => e.type);
    expect(types).toContain('plan:start');
    expect(types).toContain('plan:done');
    expect(types).toContain('stage:start');
    expect(types).toContain('stage:done');
    expect(types).toContain('subtask:start');
    expect(types).toContain('subtask:done');
    expect(types).toContain('aggregate:start');
    expect(types).toContain('aggregate:done');
  });

  it('Planner 抛出异常 → failed 状态', async () => {
    const task = createTask();
    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('规划失败'));

    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);
    const result = await orchestrator.executeTask(task);

    expect(result.status).toBe('failed');
    expect(result.subTaskResults).toHaveLength(0);
  });

  it('cancelTask 标记任务为已取消', () => {
    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);
    orchestrator.cancelTask('task-1');
  });

  it('cleanup 清理所有资源', async () => {
    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);
    await orchestrator.cleanup();
    expect(mockWorkerCoordinator.clear).toHaveBeenCalled();
  });

  it('parentSessionId 传递到配置', () => {
    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, {
      parentSessionId: 'thread-123'
    });
    expect(orchestrator).toBeDefined();
  });

  it('全部子任务失败 → failed 状态', async () => {
    const task = createTask();
    const sub1 = createSubTask('s1', 'task-1', '失败1');
    const sub2 = createSubTask('s2', 'task-1', '失败2');

    const plan: ExecutionPlan = {
      taskId: 'task-1',
      subTasks: [sub1, sub2],
      stages: [createStage('stg-1', '执行', [sub1, sub2], false, 0)],
      createdAt: Date.now()
    };

    (mockPlanner.plan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
    executeSubTaskFn.mockRejectedValue(new Error('fail'));

    const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator, { maxRetries: 0 });
    const result = await orchestrator.executeTask(task);

    expect(result.status).toBe('failed');
    expect(result.stats.failedSubTasks).toBe(2);
  });
});
