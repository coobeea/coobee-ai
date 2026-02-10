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
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockRun, mockAgentInstances } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockAgentInstances: [] as Array<{ name: string }>
}))

// ===== Mock @openai/agents =====
vi.mock('@openai/agents', () => ({
  Agent: vi.fn().mockImplementation(function (config: { name?: string }) {
    const instance = { name: config?.name || 'Agent' }
    mockAgentInstances.push(instance)
    return instance
  }),
  run: (...args: unknown[]) => mockRun(...args)
}))

import { WorkerCoordinator } from '../WorkerCoordinator'
import type { SubTask } from '../types'

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
  }
}

describe('WorkerCoordinator', () => {
  let coordinator: WorkerCoordinator

  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentInstances.length = 0
    coordinator = new WorkerCoordinator()
  })

  // ===== getOrCreateWorker =====

  describe('getOrCreateWorker', () => {
    it('创建新的 Worker', async () => {
      const worker = await coordinator.getOrCreateWorker('code')

      expect(worker.id).toContain('worker-code-')
      expect(worker.type).toBe('code')
      expect(worker.status).toBe('idle')
      expect(worker.agent).toBeDefined()
    })

    it('复用空闲的 Worker', async () => {
      const worker1 = await coordinator.getOrCreateWorker('chat')
      const worker2 = await coordinator.getOrCreateWorker('chat')

      // 第一个 Worker 空闲，应该复用
      expect(worker1).toBe(worker2)
      // Agent 只创建了一次
      expect(mockAgentInstances.length).toBe(1)
    })

    it('不复用忙碌的 Worker', async () => {
      const worker1 = await coordinator.getOrCreateWorker('code')
      // 模拟 worker1 忙碌
      worker1.status = 'busy'

      const worker2 = await coordinator.getOrCreateWorker('code')

      expect(worker1).not.toBe(worker2)
      expect(mockAgentInstances.length).toBe(2)
    })

    it('根据 Worker 类型创建正确配置的 Agent', async () => {
      const { Agent } = await import('@openai/agents')

      await coordinator.getOrCreateWorker('code')
      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Code Worker',
          model: 'gpt-4o'
        })
      )

      await coordinator.getOrCreateWorker('research')
      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Research Worker',
          model: 'gpt-4o'
        })
      )

      // 默认映射到 chat
      const w = await coordinator.getOrCreateWorker('unknown')
      // unknown type 应该 fallback to chat
      expect(w.agent).toBeDefined()
    })
  })

  // ===== executeSubTask =====

  describe('executeSubTask', () => {
    it('成功执行子任务', async () => {
      mockRun.mockResolvedValue({ finalOutput: 'task completed' })

      const worker = await coordinator.getOrCreateWorker('code')
      const subTask = createSubTask()

      const result = await coordinator.executeSubTask(subTask, worker)

      expect(result).toBe('task completed')
      expect(mockRun).toHaveBeenCalledWith(
        worker.agent,
        expect.stringContaining('Test subtask'),
        expect.objectContaining({ maxTurns: 25 })
      )
      // 执行后 Worker 恢复空闲
      expect(worker.status).toBe('idle')
    })

    it('执行中 Worker 状态为 busy', async () => {
      let capturedStatus = ''
      mockRun.mockImplementation(async () => {
        // 执行中检查状态
        const w = coordinator.getWorkerStatus('worker-code-1')
        capturedStatus = w?.status || ''
        return { finalOutput: 'done' }
      })

      const worker = await coordinator.getOrCreateWorker('code')
      await coordinator.executeSubTask(createSubTask(), worker)

      expect(capturedStatus).toBe('busy')
    })

    it('执行失败时 Worker 状态为 error', async () => {
      mockRun.mockRejectedValue(new Error('execution failed'))

      const worker = await coordinator.getOrCreateWorker('code')

      await expect(coordinator.executeSubTask(createSubTask(), worker)).rejects.toThrow(
        'execution failed'
      )

      expect(worker.status).toBe('error')
    })

    it('构建包含依赖信息的提示词', async () => {
      mockRun.mockResolvedValue({ finalOutput: 'done' })

      const worker = await coordinator.getOrCreateWorker('code')
      const subTask = createSubTask({
        name: 'Implement feature',
        description: 'Build the login page',
        dependencies: ['subtask-1', 'subtask-2']
      })

      await coordinator.executeSubTask(subTask, worker)

      const prompt = mockRun.mock.calls[0][1]
      expect(prompt).toContain('Implement feature')
      expect(prompt).toContain('Build the login page')
      expect(prompt).toContain('subtask-1')
      expect(prompt).toContain('subtask-2')
    })
  })

  // ===== getWorkerStatus =====

  describe('getWorkerStatus', () => {
    it('获取已创建的 Worker 状态', async () => {
      const worker = await coordinator.getOrCreateWorker('code')
      const status = coordinator.getWorkerStatus(worker.id)

      expect(status).toBe(worker)
    })

    it('不存在返回 null', () => {
      expect(coordinator.getWorkerStatus('nope')).toBeNull()
    })
  })

  // ===== clear =====

  describe('clear', () => {
    it('清理所有 Worker', async () => {
      const worker = await coordinator.getOrCreateWorker('code')

      coordinator.clear()

      expect(coordinator.getWorkerStatus(worker.id)).toBeNull()
    })

    it('清理后重新创建 Worker', async () => {
      await coordinator.getOrCreateWorker('code')
      const w1 = coordinator.getWorkerStatus('worker-code-1')
      if (w1) w1.status = 'busy'

      await coordinator.getOrCreateWorker('code')

      coordinator.clear()

      const worker = await coordinator.getOrCreateWorker('chat')
      expect(worker.id).toContain('worker-chat-')
    })
  })
})
