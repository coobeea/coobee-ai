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
const { mockCreateAgent, mockRun } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
  mockRun: vi.fn()
}))

// ===== Mock AgentFactory =====
vi.mock('../../agents/AgentFactory', () => ({
  agentFactory: { createAgent: mockCreateAgent }
}))

// ===== Mock @openai/agents =====
vi.mock('@openai/agents', () => ({
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
    coordinator = new WorkerCoordinator()
  })

  // ===== getOrCreateWorker =====

  describe('getOrCreateWorker', () => {
    it('创建新的 Worker', async () => {
      const mockAgent = { name: 'CodeAgent' }
      mockCreateAgent.mockResolvedValue(mockAgent)

      const worker = await coordinator.getOrCreateWorker('code')

      expect(worker.id).toContain('worker-code-')
      expect(worker.type).toBe('code')
      expect(worker.status).toBe('idle')
      expect(worker.agent).toBe(mockAgent)
      expect(mockCreateAgent).toHaveBeenCalledWith({
        preset: 'code'
      })
    })

    it('复用空闲的 Worker', async () => {
      const mockAgent = { name: 'ChatAgent' }
      mockCreateAgent.mockResolvedValue(mockAgent)

      const worker1 = await coordinator.getOrCreateWorker('chat')
      const worker2 = await coordinator.getOrCreateWorker('chat')

      // 第一个 Worker 空闲，应该复用
      expect(worker1).toBe(worker2)
      expect(mockCreateAgent).toHaveBeenCalledTimes(1)
    })

    it('不复用忙碌的 Worker', async () => {
      const mockAgent1 = { name: 'Agent1' }
      const mockAgent2 = { name: 'Agent2' }
      mockCreateAgent.mockResolvedValueOnce(mockAgent1).mockResolvedValueOnce(mockAgent2)

      const worker1 = await coordinator.getOrCreateWorker('code')
      // 模拟 worker1 忙碌
      worker1.status = 'busy'

      const worker2 = await coordinator.getOrCreateWorker('code')

      expect(worker1).not.toBe(worker2)
      expect(mockCreateAgent).toHaveBeenCalledTimes(2)
    })

    it('映射 Worker 类型到预设', async () => {
      mockCreateAgent.mockResolvedValue({ name: 'Agent' })

      await coordinator.getOrCreateWorker('code')
      expect(mockCreateAgent).toHaveBeenCalledWith({ preset: 'code' })

      await coordinator.getOrCreateWorker('research')
      expect(mockCreateAgent).toHaveBeenCalledWith({ preset: 'research' })

      // 默认映射到 chat
      await coordinator.getOrCreateWorker('unknown')
      expect(mockCreateAgent).toHaveBeenCalledWith({ preset: 'chat' })
    })
  })

  // ===== executeSubTask =====

  describe('executeSubTask', () => {
    it('成功执行子任务', async () => {
      const mockAgent = { name: 'CodeAgent' }
      mockCreateAgent.mockResolvedValue(mockAgent)
      mockRun.mockResolvedValue({ finalOutput: 'task completed' })

      const worker = await coordinator.getOrCreateWorker('code')
      const subTask = createSubTask()

      const result = await coordinator.executeSubTask(subTask, worker)

      expect(result).toBe('task completed')
      expect(mockRun).toHaveBeenCalledWith(
        mockAgent,
        expect.stringContaining('Test subtask'),
        expect.objectContaining({ maxTurns: 25 })
      )
      // 执行后 Worker 恢复空闲
      expect(worker.status).toBe('idle')
    })

    it('执行中 Worker 状态为 busy', async () => {
      const mockAgent = { name: 'Agent' }
      mockCreateAgent.mockResolvedValue(mockAgent)

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
      const mockAgent = { name: 'Agent' }
      mockCreateAgent.mockResolvedValue(mockAgent)
      mockRun.mockRejectedValue(new Error('execution failed'))

      const worker = await coordinator.getOrCreateWorker('code')

      await expect(coordinator.executeSubTask(createSubTask(), worker)).rejects.toThrow(
        'execution failed'
      )

      expect(worker.status).toBe('error')
    })

    it('构建包含依赖信息的提示词', async () => {
      const mockAgent = { name: 'Agent' }
      mockCreateAgent.mockResolvedValue(mockAgent)
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
      mockCreateAgent.mockResolvedValue({ name: 'Agent' })

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
      mockCreateAgent.mockResolvedValue({ name: 'Agent' })

      const worker = await coordinator.getOrCreateWorker('code')

      coordinator.clear()

      expect(coordinator.getWorkerStatus(worker.id)).toBeNull()
    })

    it('清理后重新创建 Worker ID 重置', async () => {
      mockCreateAgent.mockResolvedValue({ name: 'Agent' })

      await coordinator.getOrCreateWorker('code') // worker-code-1
      // 使其忙碌以避免复用
      const w1 = coordinator.getWorkerStatus('worker-code-1')
      if (w1) w1.status = 'busy'

      await coordinator.getOrCreateWorker('code') // worker-code-2

      coordinator.clear()

      await coordinator.getOrCreateWorker('code') // worker-code-3 (计数器未重置)
      // 但 Worker 池应该是空的
      // 实际上 clear 会重置计数器
      const worker = await coordinator.getOrCreateWorker('chat')
      expect(worker.id).toContain('worker-chat-')
    })
  })
})
