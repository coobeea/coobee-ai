import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../Orchestrator';
import type { IPlanner } from '../Planner';
import type { IWorkerCoordinator } from '../WorkerCoordinator';
import type { IAggregator } from '../AggregatorAgent';
import type { Task, ExecutionPlan } from '../types';

describe('意图感知的编排模式', () => {
  let mockPlanner: IPlanner;
  let mockWorkerCoordinator: IWorkerCoordinator;
  let mockAggregator: IAggregator;

  beforeEach(() => {
    mockPlanner = {
      plan: vi.fn(),
      replan: vi.fn()
    };

    mockWorkerCoordinator = {
      getOrCreateWorker: vi.fn(),
      executeSubTask: vi.fn(),
      getWorkerStatus: vi.fn(),
      clear: vi.fn()
    };

    mockAggregator = {
      aggregate: vi.fn()
    };
  });

  describe('简单消息自动降级', () => {
    it('应该识别简单问候语并跳过编排', async () => {
      const task: Task = {
        id: 'test-task-1',
        objective: '你好'
      };

      // Mock Planner 返回 needsOrchestration=false
      const simplePlan: ExecutionPlan = {
        taskId: task.id,
        needsOrchestration: false,
        reason: '这是一个简单的问候，不需要多智能体编排',
        subTasks: [],
        stages: [],
        createdAt: Date.now()
      };

      vi.mocked(mockPlanner.plan).mockResolvedValue(simplePlan);

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);

      const result = await orchestrator.executeTask(task);

      // 验证：应该直接返回，不执行子任务
      expect(result.status).toBe('success');
      expect(result.finalOutput).toContain('简单');
      expect(result.subTaskResults).toHaveLength(0);
      expect(result.stats.totalSubTasks).toBe(0);

      // 验证：Planner 被调用，但 WorkerCoordinator 和 Aggregator 未被调用
      expect(mockPlanner.plan).toHaveBeenCalledTimes(1);
      expect(mockWorkerCoordinator.executeSubTask).not.toHaveBeenCalled();
      expect(mockAggregator.aggregate).not.toHaveBeenCalled();
    });

    it('应该识别简单查询并跳过编排', async () => {
      const task: Task = {
        id: 'test-task-2',
        objective: '今天几点'
      };

      const simplePlan: ExecutionPlan = {
        taskId: task.id,
        needsOrchestration: false,
        reason: '这是一个简单的时间查询，不需要编排',
        subTasks: [],
        stages: [],
        createdAt: Date.now()
      };

      vi.mocked(mockPlanner.plan).mockResolvedValue(simplePlan);

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);

      const result = await orchestrator.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.finalOutput).toContain('简单');
      expect(mockWorkerCoordinator.executeSubTask).not.toHaveBeenCalled();
    });
  });

  describe('复杂任务正常编排', () => {
    it('应该对复杂任务执行完整编排流程', async () => {
      const task: Task = {
        id: 'test-task-3',
        objective: '创建一个音乐播放器网站，包括前端、后端和数据库'
      };

      const complexPlan: ExecutionPlan = {
        taskId: task.id,
        needsOrchestration: true,
        subTasks: [
          {
            id: 'subtask-1',
            taskId: task.id,
            name: '设计数据库schema',
            description: '设计音乐、用户、播放列表表结构',
            assignedWorker: 'backend',
            status: 'pending'
          },
          {
            id: 'subtask-2',
            taskId: task.id,
            name: '开发后端 API',
            description: '实现 RESTful API',
            dependencies: ['subtask-1'],
            assignedWorker: 'backend',
            status: 'pending'
          },
          {
            id: 'subtask-3',
            taskId: task.id,
            name: '开发前端界面',
            description: '实现播放器 UI',
            assignedWorker: 'frontend',
            status: 'pending'
          }
        ],
        stages: [
          {
            id: 'stage-1',
            name: 'Backend Development',
            tasks: [],
            order: 0,
            parallel: false
          },
          {
            id: 'stage-2',
            name: 'Frontend Development',
            tasks: [],
            order: 1,
            parallel: false
          }
        ],
        createdAt: Date.now()
      };

      vi.mocked(mockPlanner.plan).mockResolvedValue(complexPlan);

      vi.mocked(mockWorkerCoordinator.executeSubTask).mockResolvedValue({
        output: 'Task completed',
        duration: 1000
      });

      vi.mocked(mockAggregator.aggregate).mockResolvedValue({
        summary: '成功创建了音乐播放器网站，包括前端、后端和数据库',
        duration: 5000
      });

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);

      const result = await orchestrator.executeTask(task);

      // 验证：应该执行完整流程
      expect(result.status).toBe('success');
      expect(mockPlanner.plan).toHaveBeenCalledTimes(1);
      expect(mockWorkerCoordinator.executeSubTask).toHaveBeenCalled();
      expect(mockAggregator.aggregate).toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('应该处理 Planner 返回的空计划', async () => {
      const task: Task = {
        id: 'test-task-4',
        objective: '嗯'
      };

      const emptyPlan: ExecutionPlan = {
        taskId: task.id,
        needsOrchestration: false,
        subTasks: [],
        stages: [],
        createdAt: Date.now()
      };

      vi.mocked(mockPlanner.plan).mockResolvedValue(emptyPlan);

      const orchestrator = new Orchestrator(mockPlanner, mockWorkerCoordinator, mockAggregator);

      const result = await orchestrator.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.stats.totalSubTasks).toBe(0);
    });
  });
});
