/**
 * RuntimeFactory 测试
 *
 * 测试运行时工厂：
 * - 创建 Agent / Team 运行时
 * - 缓存机制
 * - 获取和销毁
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockInitialize, mockDestroy, counter } = vi.hoisted(() => ({
  mockInitialize: vi.fn().mockResolvedValue(undefined),
  mockDestroy: vi.fn().mockResolvedValue(undefined),
  counter: { value: 0 }
}))

// ===== Mock AgentRuntime =====
vi.mock('../AgentRuntime', () => ({
  AgentRuntime: vi.fn().mockImplementation(function (options: { name: string }) {
    return {
      type: 'agent',
      id: `agent-${++counter.value}`,
      name: options.name,
      interrupted: false,
      initialize: mockInitialize,
      destroy: mockDestroy
    }
  })
}))

// ===== Mock TeamRuntime =====
vi.mock('../TeamRuntime', () => ({
  TeamRuntime: vi.fn().mockImplementation(function (options: { name: string }) {
    return {
      type: 'team',
      id: `team-${++counter.value}`,
      name: options.name,
      interrupted: false,
      initialize: mockInitialize,
      destroy: mockDestroy
    }
  })
}))

import { RuntimeFactory } from '../RuntimeFactory'

describe('RuntimeFactory', () => {
  let factory: RuntimeFactory

  beforeEach(() => {
    vi.clearAllMocks()
    factory = new RuntimeFactory()
  })

  // ===== createRuntime =====

  describe('createRuntime', () => {
    it('创建 Agent 运行时', async () => {
      const runtime = await factory.createRuntime({
        type: 'agent',
        options: {
          name: 'TestAgent',
          instructions: 'You are helpful.'
        }
      })

      expect(runtime.type).toBe('agent')
      expect(runtime.name).toBe('TestAgent')
      expect(mockInitialize).toHaveBeenCalled()
    })

    it('创建 Team 运行时', async () => {
      const runtime = await factory.createRuntime({
        type: 'team',
        options: {
          name: 'TestTeam',
          orchestrationType: 'sequential',
          members: [
            {
              name: 'Agent1',
              instructions: 'Do things',
              role: 'worker'
            }
          ]
        }
      })

      expect(runtime.type).toBe('team')
      expect(runtime.name).toBe('TestTeam')
      expect(mockInitialize).toHaveBeenCalled()
    })
  })

  // ===== getRuntime =====

  describe('getRuntime', () => {
    it('获取已创建的运行时', async () => {
      const runtime = await factory.createRuntime({
        type: 'agent',
        options: {
          name: 'TestAgent',
          instructions: 'You are helpful.'
        }
      })

      const found = factory.getRuntime(runtime.id)
      expect(found).toBe(runtime)
    })

    it('不存在返回 null', () => {
      expect(factory.getRuntime('nonexistent')).toBeNull()
    })
  })

  // ===== destroyRuntime =====

  describe('destroyRuntime', () => {
    it('销毁运行时', async () => {
      const runtime = await factory.createRuntime({
        type: 'agent',
        options: {
          name: 'TestAgent',
          instructions: 'You are helpful.'
        }
      })

      await factory.destroyRuntime(runtime.id)

      expect(mockDestroy).toHaveBeenCalled()
      expect(factory.getRuntime(runtime.id)).toBeNull()
    })
  })

  // ===== destroyAll =====

  describe('destroyAll', () => {
    it('销毁所有运行时', async () => {
      await factory.createRuntime({
        type: 'agent',
        options: { name: 'Agent1', instructions: 'hi' }
      })
      await factory.createRuntime({
        type: 'agent',
        options: { name: 'Agent2', instructions: 'hi' }
      })

      await factory.destroyAll()

      expect(mockDestroy).toHaveBeenCalledTimes(2)
      expect(factory.getAllRuntimes()).toHaveLength(0)
    })
  })

  // ===== getAllRuntimes =====

  describe('getAllRuntimes', () => {
    it('返回所有运行时', async () => {
      await factory.createRuntime({
        type: 'agent',
        options: { name: 'A1', instructions: 'hi' }
      })
      await factory.createRuntime({
        type: 'agent',
        options: { name: 'A2', instructions: 'hi' }
      })

      expect(factory.getAllRuntimes()).toHaveLength(2)
    })
  })
})
