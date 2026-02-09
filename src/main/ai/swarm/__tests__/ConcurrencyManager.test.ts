/**
 * ConcurrencyManager 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@openai/agents', () => ({
  Agent: class {
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(c: any) {
      this.name = c?.name || 'mock'
    }
  },
  run: vi.fn().mockResolvedValue({ finalOutput: 'result' })
}))

import { ConcurrencyManager, type SwarmSubTask } from '../ConcurrencyManager'
import { run } from '@openai/agents'
import type { SwarmConfig } from '../types'

const config: SwarmConfig = {
  id: 'test',
  name: 'Test',
  maxConcurrentAgents: 3,
  agentIdleTimeout: 60000,
  maxHandoffDepth: 5,
  enableSharedContext: true,
  enableMonitoring: true
}

describe('ConcurrencyManager', () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ConcurrencyManager(config)
  })

  describe('buildExecutionPhases', () => {
    it('无依赖任务放在一个阶段', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'task 1', roleId: 'coder' },
        { id: 't2', input: 'task 2', roleId: 'reviewer' }
      ]

      const phases = manager.buildExecutionPhases(tasks)
      expect(phases).toHaveLength(1)
      expect(phases[0]).toHaveLength(2)
    })

    it('有依赖的任务分阶段', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'write code', roleId: 'coder' },
        { id: 't2', input: 'review code', roleId: 'reviewer', dependencies: ['t1'] },
        { id: 't3', input: 'test code', roleId: 'tester', dependencies: ['t1'] },
        { id: 't4', input: 'deploy', roleId: 'deployer', dependencies: ['t2', 't3'] }
      ]

      const phases = manager.buildExecutionPhases(tasks)
      expect(phases).toHaveLength(3)
      expect(phases[0]).toHaveLength(1) // t1
      expect(phases[1]).toHaveLength(2) // t2, t3
      expect(phases[2]).toHaveLength(1) // t4
    })

    it('循环依赖强制执行', () => {
      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'a', roleId: 'r1', dependencies: ['t2'] },
        { id: 't2', input: 'b', roleId: 'r2', dependencies: ['t1'] }
      ]

      const phases = manager.buildExecutionPhases(tasks)
      // 应该强制执行剩余任务
      expect(phases.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('executeSimpleParallel', () => {
    it('并行执行所有任务', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = { name: 'mock' } as any
      const tasks = [
        { id: 't1', input: 'a', agent, roleId: 'r1' },
        { id: 't2', input: 'b', agent, roleId: 'r2' }
      ]

      const results = await manager.executeSimpleParallel(tasks)
      expect(results).toHaveLength(2)
      expect(results.every((r) => r.success)).toBe(true)
      expect(run).toHaveBeenCalledTimes(2)
    })

    it('任务失败不影响其他', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(vi.mocked(run) as any)
        .mockResolvedValueOnce({ finalOutput: 'ok' })
        .mockRejectedValueOnce(new Error('fail'))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = { name: 'mock' } as any
      const tasks = [
        { id: 't1', input: 'a', agent, roleId: 'r1' },
        { id: 't2', input: 'b', agent, roleId: 'r2' }
      ]

      const results = await manager.executeSimpleParallel(tasks)
      expect(results).toHaveLength(2)

      const success = results.filter((r) => r.success)
      const failed = results.filter((r) => !r.success)
      expect(success).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect(failed[0].error).toContain('fail')
    })
  })

  describe('executeParallel', () => {
    it('按阶段执行并聚合结果', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agents = new Map<string, any>()
      agents.set('coder', { name: 'Coder' })
      agents.set('reviewer', { name: 'Reviewer' })

      const tasks: SwarmSubTask[] = [
        { id: 't1', input: 'code', roleId: 'coder' },
        { id: 't2', input: 'review', roleId: 'reviewer', dependencies: ['t1'] }
      ]

      const result = await manager.executeParallel(tasks, agents)
      expect(result.results).toHaveLength(2)
      expect(result.successCount).toBe(2)
      expect(result.failCount).toBe(0)
      expect(result.totalDuration).toBeGreaterThanOrEqual(0)
      expect(result.aggregatedOutput).toContain('coder')
    })

    it('缺少 Agent 时记录失败', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agents = new Map<string, any>()
      // 没有提供任何 agent

      const tasks: SwarmSubTask[] = [{ id: 't1', input: 'task', roleId: 'missing' }]

      const result = await manager.executeParallel(tasks, agents)
      expect(result.failCount).toBe(1)
      expect(result.results[0].error).toContain('Agent not found')
    })
  })

  describe('状态查询', () => {
    it('getRunningCount 初始为 0', () => {
      expect(manager.getRunningCount()).toBe(0)
    })

    it('isAtCapacity 初始为 false', () => {
      expect(manager.isAtCapacity()).toBe(false)
    })
  })

  describe('事件系统', () => {
    it('addEventListener 接收事件', async () => {
      const listener = vi.fn()
      manager.addEventListener(listener)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = { name: 'mock' } as any
      await manager.executeSimpleParallel([{ id: 't1', input: 'a', agent, roleId: 'r1' }])

      expect(listener).toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = listener.mock.calls.map((c: any) => c[0].type)
      expect(events).toContain('task_started')
      expect(events).toContain('task_completed')
    })
  })

  describe('destroy', () => {
    it('清理资源', () => {
      manager.destroy()
      expect(manager.getRunningCount()).toBe(0)
    })
  })
})
