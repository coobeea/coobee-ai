/**
 * Planner 测试
 *
 * 测试规划者的核心功能：
 * - plan: 将任务分解为子任务和执行阶段
 * - replan: 在失败后重新规划
 * - 输出解析策略（纯 JSON、markdown 代码块、嵌入 JSON）
 * - 空输出时的降级处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Mock AgentExecutor（Planner 通过它创建 Runtime） =====
const mockRunResult = vi.fn();

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

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
          destroy: vi.fn().mockResolvedValue(undefined)
        })
      };
      return builder;
    }
  }
}));

import { Planner } from '../Planner';
import type { Task } from '../types';

describe('Planner', () => {
  let planner: Planner;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new Planner();
  });

  // ===== plan =====

  describe('plan', () => {
    it('成功规划任务 — 从 JSON 输出', async () => {
      const planOutput = {
        subTasks: [
          {
            id: 'subtask-1',
            objective: 'Research topic',
            description: 'Gather information',
            dependencies: [],
            assignedWorker: 'research'
          },
          {
            id: 'subtask-2',
            objective: 'Write code',
            description: 'Implement solution',
            dependencies: ['subtask-1'],
            assignedWorker: 'code'
          }
        ],
        stages: [
          {
            stageId: 'stage-1',
            name: 'Research Phase',
            subTaskIds: ['subtask-1'],
            parallelizable: false
          },
          {
            stageId: 'stage-2',
            name: 'Implementation Phase',
            subTaskIds: ['subtask-2'],
            parallelizable: false
          }
        ]
      };

      mockRunResult.mockResolvedValue({ output: JSON.stringify(planOutput) });

      const task: Task = {
        id: 'task-1',
        objective: 'Build a web scraper'
      };

      const plan = await planner.plan(task);

      expect(plan.taskId).toBe('task-1');
      expect(plan.subTasks).toHaveLength(2);
      expect(plan.subTasks[0].name).toBe('Research topic');
      expect(plan.subTasks[0].assignedWorker).toBe('research');
      expect(plan.subTasks[0].status).toBe('pending');
      expect(plan.subTasks[1].dependencies).toEqual(['subtask-1']);
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0].name).toBe('Research Phase');
      expect(plan.createdAt).toBeGreaterThan(0);
    });

    it('从 markdown 代码块中提取 JSON', async () => {
      const planOutput = {
        subTasks: [{ id: 's1', objective: 'Task A', dependencies: [], assignedWorker: 'general' }],
        stages: [{ stageId: 'st1', name: 'Stage 1', subTaskIds: ['s1'], parallelizable: false }]
      };

      const markdownOutput = `Here is the plan:\n\`\`\`json\n${JSON.stringify(planOutput, null, 2)}\n\`\`\`\nLet me know if this works.`;
      mockRunResult.mockResolvedValue({ output: markdownOutput });

      const task: Task = { id: 'task-2', objective: 'Analyze data' };
      const plan = await planner.plan(task);

      expect(plan.taskId).toBe('task-2');
      expect(plan.subTasks).toHaveLength(1);
      expect(plan.subTasks[0].name).toBe('Task A');
    });

    it('从嵌入的 JSON 对象中提取', async () => {
      const planOutput = {
        subTasks: [{ id: 's1', objective: 'Do it', dependencies: [], assignedWorker: 'general' }],
        stages: [{ stageId: 'st1', name: 'Main', subTaskIds: ['s1'], parallelizable: false }]
      };

      const output = `OK here is my analysis:\n${JSON.stringify(planOutput)}\nHope this helps!`;
      mockRunResult.mockResolvedValue({ output });

      const plan = await planner.plan({ id: 'task-3', objective: 'Test' });

      expect(plan.subTasks).toHaveLength(1);
      expect(plan.subTasks[0].name).toBe('Do it');
    });

    it('LLM 返回空内容时使用默认计划', async () => {
      mockRunResult.mockResolvedValue({ output: '' });

      const task: Task = { id: 'task-4', objective: 'Simple task' };
      const plan = await planner.plan(task);

      expect(plan.taskId).toBe('task-4');
      expect(plan.subTasks).toHaveLength(1);
      expect(plan.subTasks[0].name).toBe('Complete the task');
      expect(plan.subTasks[0].assignedWorker).toBe('general');
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0].name).toBe('Main Stage');
    });

    it('LLM 执行失败时使用默认计划', async () => {
      mockRunResult.mockRejectedValue(new Error('LLM error'));

      const task: Task = { id: 'task-5', objective: 'Failed task' };
      const plan = await planner.plan(task);

      expect(plan.subTasks).toHaveLength(1);
      expect(plan.stages).toHaveLength(1);
    });

    it('提示词包含任务详细信息', async () => {
      mockRunResult.mockResolvedValue({ output: '{}' });

      const task: Task = {
        id: 'task-6',
        objective: 'Analyze data',
        description: 'Detailed analysis of user behavior',
        requirements: ['Must be fast'],
        constraints: ['No external APIs'],
        context: { dataset: 'users.csv' }
      };

      await planner.plan(task);

      const prompt = mockRunResult.mock.calls[0][0];
      expect(prompt).toContain('Analyze data');
      expect(prompt).toContain('Detailed analysis of user behavior');
      expect(prompt).toContain('Must be fast');
      expect(prompt).toContain('No external APIs');
      expect(prompt).toContain('users.csv');
    });
  });

  // ===== replan =====

  describe('replan', () => {
    it('根据失败信息重新规划', async () => {
      const replanOutput = {
        subTasks: [
          {
            id: 'subtask-alt',
            objective: 'Alternative approach',
            dependencies: [],
            assignedWorker: 'code'
          }
        ],
        stages: [
          {
            stageId: 'stage-alt',
            name: 'Alternative Stage',
            subTaskIds: ['subtask-alt'],
            parallelizable: false
          }
        ]
      };

      mockRunResult.mockResolvedValue({ output: JSON.stringify(replanOutput) });

      const task: Task = { id: 'task-1', objective: 'Build feature' };

      const plan = await planner.replan(task, {
        failedSubTaskId: 'subtask-original',
        reason: 'API rate limit exceeded'
      });

      expect(plan.taskId).toBe('task-1');
      expect(plan.subTasks[0].name).toBe('Alternative approach');

      const prompt = mockRunResult.mock.calls[0][0];
      expect(prompt).toContain('subtask-original');
      expect(prompt).toContain('API rate limit exceeded');
    });
  });
});
