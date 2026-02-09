/**
 * Planner 测试
 *
 * 测试规划者的核心功能：
 * - plan: 将任务分解为子任务和执行阶段
 * - replan: 在失败后重新规划
 * - outputType 结构化输出的正确性
 * - 空输出时的降级处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Mock @openai/agents =====
const mockRun = vi.fn()
vi.mock('@openai/agents', () => ({
  Agent: class MockAgent {
    name: string
    instructions: string
    model: string
    outputType: unknown
    constructor(config: Record<string, unknown>) {
      this.name = (config.name as string) || 'MockAgent'
      this.instructions = (config.instructions as string) || ''
      this.model = (config.model as string) || 'gpt-4o'
      this.outputType = config.outputType
    }
  },
  run: (...args: unknown[]) => mockRun(...args)
}))

import { Planner } from '../Planner'
import type { Task } from '../types'

describe('Planner', () => {
  let planner: Planner

  beforeEach(() => {
    vi.clearAllMocks()
    planner = new Planner()
  })

  // ===== plan =====

  describe('plan', () => {
    it('成功规划任务（结构化输出）', async () => {
      // SDK outputType: finalOutput 直接是已解析的对象
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
      }

      mockRun.mockResolvedValue({ finalOutput: planOutput })

      const task: Task = {
        id: 'task-1',
        objective: 'Build a web scraper'
      }

      const plan = await planner.plan(task)

      expect(plan.taskId).toBe('task-1')
      expect(plan.subTasks).toHaveLength(2)
      expect(plan.subTasks[0].name).toBe('Research topic')
      expect(plan.subTasks[0].assignedWorker).toBe('research')
      expect(plan.subTasks[0].status).toBe('pending')
      expect(plan.subTasks[1].dependencies).toEqual(['subtask-1'])
      expect(plan.stages).toHaveLength(2)
      expect(plan.stages[0].name).toBe('Research Phase')
      expect(plan.createdAt).toBeGreaterThan(0)
    })

    it('包含描述和上下文的任务', async () => {
      mockRun.mockResolvedValue({
        finalOutput: {
          subTasks: [{ id: 's1', objective: 'Task A', dependencies: [], assignedWorker: 'chat' }],
          stages: [{ stageId: 'st1', name: 'Stage 1', subTaskIds: ['s1'], parallelizable: false }]
        }
      })

      const task: Task = {
        id: 'task-2',
        objective: 'Analyze data',
        description: 'Detailed analysis of user behavior',
        context: { dataset: 'users.csv', format: 'CSV' }
      }

      const plan = await planner.plan(task)

      // 验证 run 被正确调用，提示词包含任务信息，第三个参数是 maxTurns 选项
      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Analyze data'),
        expect.objectContaining({ maxTurns: expect.any(Number) })
      )
      expect(plan.taskId).toBe('task-2')
    })

    it('outputType 返回 undefined 时使用默认计划', async () => {
      // SDK outputType 解析失败时 finalOutput 可能为 undefined
      mockRun.mockResolvedValue({ finalOutput: undefined })

      const task: Task = {
        id: 'task-3',
        objective: 'Simple task'
      }

      const plan = await planner.plan(task)

      expect(plan.taskId).toBe('task-3')
      expect(plan.subTasks).toHaveLength(1)
      expect(plan.subTasks[0].name).toBe('Complete the task')
      expect(plan.subTasks[0].assignedWorker).toBe('chat')
      expect(plan.stages).toHaveLength(1)
      expect(plan.stages[0].name).toBe('Main Stage')
    })

    it('空输出时返回默认计划', async () => {
      mockRun.mockResolvedValue({ finalOutput: undefined })

      const task: Task = { id: 'task-4', objective: 'Empty result' }
      const plan = await planner.plan(task)

      expect(plan.subTasks).toHaveLength(1)
      expect(plan.stages).toHaveLength(1)
    })
  })

  // ===== replan =====

  describe('replan', () => {
    it('根据失败信息重新规划', async () => {
      mockRun.mockResolvedValue({
        finalOutput: {
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
        }
      })

      const task: Task = { id: 'task-1', objective: 'Build feature' }

      const plan = await planner.replan(task, {
        failedSubTaskId: 'subtask-original',
        reason: 'API rate limit exceeded'
      })

      expect(plan.taskId).toBe('task-1')
      expect(plan.subTasks[0].name).toBe('Alternative approach')

      // 验证 replan 提示词包含失败信息（第三个参数是 maxTurns 选项）
      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('subtask-original'),
        expect.objectContaining({ maxTurns: expect.any(Number) })
      )
      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('API rate limit exceeded'),
        expect.objectContaining({ maxTurns: expect.any(Number) })
      )
    })
  })
})
