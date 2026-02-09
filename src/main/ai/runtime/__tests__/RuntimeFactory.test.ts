/**
 * RuntimeFactory 测试
 *
 * 测试运行时工厂的核心功能：
 * - 根据类型创建运行时 (agent/team/swarm)
 * - 运行时缓存（同 key 返回同一实例）
 * - 自动检测类型创建运行时
 * - 获取已创建的运行时
 * - 销毁单个/全部运行时
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const {
  mockAgentInitialize,
  mockAgentDestroy,
  mockTeamInitialize,
  mockTeamDestroy,
  mockSwarmInitialize,
  mockSwarmDestroy,
  mockGetConfig,
  mockGetTeam
} = vi.hoisted(() => ({
  mockAgentInitialize: vi.fn().mockResolvedValue(undefined),
  mockAgentDestroy: vi.fn().mockResolvedValue(undefined),
  mockTeamInitialize: vi.fn().mockResolvedValue(undefined),
  mockTeamDestroy: vi.fn().mockResolvedValue(undefined),
  mockSwarmInitialize: vi.fn().mockResolvedValue(undefined),
  mockSwarmDestroy: vi.fn().mockResolvedValue(undefined),
  mockGetConfig: vi.fn(),
  mockGetTeam: vi.fn()
}))

// ===== Mock AgentRuntime =====
vi.mock('../AgentRuntime', () => ({
  AgentRuntime: class MockAgentRuntime {
    type = 'agent' as const
    id: string
    name: string
    initialize = mockAgentInitialize
    destroy = mockAgentDestroy
    run = vi.fn()
    runStream = vi.fn()
    getSession = vi.fn()
    clearSession = vi.fn()
    getMemory = vi.fn()
    saveMemory = vi.fn()
    clearMemory = vi.fn()
    getTools = vi.fn().mockReturnValue([])
    setToolEnabled = vi.fn()
    getSkills = vi.fn().mockReturnValue([])
    setSkillActive = vi.fn()
    constructor(id: string, _sessionId?: string) {
      this.id = id
      this.name = `Agent-${id}`
    }
  }
}))

// ===== Mock TeamRuntime =====
vi.mock('../TeamRuntime', () => ({
  TeamRuntime: class MockTeamRuntime {
    type = 'team' as const
    id: string
    name: string
    initialize = mockTeamInitialize
    destroy = mockTeamDestroy
    run = vi.fn()
    runStream = vi.fn()
    getSession = vi.fn()
    clearSession = vi.fn()
    getMemory = vi.fn()
    saveMemory = vi.fn()
    clearMemory = vi.fn()
    getTools = vi.fn().mockReturnValue([])
    setToolEnabled = vi.fn()
    getSkills = vi.fn().mockReturnValue([])
    setSkillActive = vi.fn()
    constructor(id: string, _sessionId?: string) {
      this.id = id
      this.name = `Team-${id}`
    }
  }
}))

// ===== Mock SwarmRuntime =====
vi.mock('../../swarm/SwarmRuntime', () => ({
  SwarmRuntime: class MockSwarmRuntime {
    type = 'swarm' as const
    id: string
    name: string
    initialize = mockSwarmInitialize
    destroy = mockSwarmDestroy
    run = vi.fn()
    runStream = vi.fn()
    getSession = vi.fn()
    clearSession = vi.fn()
    getMemory = vi.fn()
    saveMemory = vi.fn()
    clearMemory = vi.fn()
    getTools = vi.fn().mockReturnValue([])
    setToolEnabled = vi.fn()
    getSkills = vi.fn().mockReturnValue([])
    setSkillActive = vi.fn()
    constructor(id: string, _sessionId?: string) {
      this.id = id
      this.name = `Swarm-${id}`
    }
  }
}))

// ===== Mock stores =====
vi.mock('../../storage/AgentConfigStore', () => ({
  agentConfigStore: { getConfig: mockGetConfig }
}))
vi.mock('../../storage/TeamConfigStore', () => ({
  teamConfigStore: { getTeam: mockGetTeam }
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
    it('创建 agent 运行时', async () => {
      const runtime = await factory.createRuntime({ type: 'agent', id: 'agent-1' })

      expect(runtime.type).toBe('agent')
      expect(runtime.id).toBe('agent-1')
      expect(mockAgentInitialize).toHaveBeenCalledOnce()
    })

    it('创建 team 运行时', async () => {
      const runtime = await factory.createRuntime({ type: 'team', id: 'team-1' })

      expect(runtime.type).toBe('team')
      expect(runtime.id).toBe('team-1')
      expect(mockTeamInitialize).toHaveBeenCalledOnce()
    })

    it('创建 swarm 运行时', async () => {
      const runtime = await factory.createRuntime({ type: 'swarm', id: 'swarm-1' })

      expect(runtime.type).toBe('swarm')
      expect(runtime.id).toBe('swarm-1')
      expect(mockSwarmInitialize).toHaveBeenCalledOnce()
    })

    it('未知类型抛出错误', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(factory.createRuntime({ type: 'unknown' as any, id: 'x' })).rejects.toThrow(
        'Unknown runtime type: unknown'
      )
    })

    it('相同 key 缓存运行时实例', async () => {
      const r1 = await factory.createRuntime({ type: 'agent', id: 'a1' })
      const r2 = await factory.createRuntime({ type: 'agent', id: 'a1' })

      expect(r1).toBe(r2)
      // 只初始化一次
      expect(mockAgentInitialize).toHaveBeenCalledTimes(1)
    })

    it('不同 sessionId 创建不同实例', async () => {
      const r1 = await factory.createRuntime({ type: 'agent', id: 'a1', sessionId: 's1' })
      const r2 = await factory.createRuntime({ type: 'agent', id: 'a1', sessionId: 's2' })

      expect(r1).not.toBe(r2)
      expect(mockAgentInitialize).toHaveBeenCalledTimes(2)
    })

    it('传递 swarmOptions 创建 SwarmRuntime', async () => {
      const runtime = await factory.createRuntime({
        type: 'swarm',
        id: 'sw1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        swarmOptions: { maxConcurrency: 5 } as any
      })

      expect(runtime.type).toBe('swarm')
      expect(runtime.id).toBe('sw1')
      expect(mockSwarmInitialize).toHaveBeenCalled()
    })
  })

  // ===== createRuntimeAuto =====

  describe('createRuntimeAuto', () => {
    it('自动检测为 agent 类型', async () => {
      mockGetConfig.mockResolvedValue({ id: 'a1', name: 'Test Agent' })
      mockGetTeam.mockResolvedValue(null)

      const runtime = await factory.createRuntimeAuto('a1')

      expect(runtime.type).toBe('agent')
      expect(mockGetConfig).toHaveBeenCalledWith('a1')
    })

    it('自动检测为 team 类型', async () => {
      mockGetConfig.mockResolvedValue(null)
      mockGetTeam.mockResolvedValue({ id: 't1', name: 'Test Team' })

      const runtime = await factory.createRuntimeAuto('t1')

      expect(runtime.type).toBe('team')
    })

    it('都不匹配时抛出错误', async () => {
      mockGetConfig.mockResolvedValue(null)
      mockGetTeam.mockResolvedValue(null)

      await expect(factory.createRuntimeAuto('nope')).rejects.toThrow('Runtime not found: nope')
    })

    it('传递 sessionId', async () => {
      mockGetConfig.mockResolvedValue({ id: 'a1', name: 'Test Agent' })

      const runtime = await factory.createRuntimeAuto('a1', 'my-session')

      expect(runtime).toBeDefined()
    })
  })

  // ===== getRuntime =====

  describe('getRuntime', () => {
    it('获取已创建的运行时', async () => {
      await factory.createRuntime({ type: 'agent', id: 'a1' })

      const runtime = factory.getRuntime('agent', 'a1')
      expect(runtime).toBeDefined()
      expect(runtime!.id).toBe('a1')
    })

    it('不存在返回 null', () => {
      expect(factory.getRuntime('agent', 'nope')).toBeNull()
    })

    it('带 sessionId 获取', async () => {
      await factory.createRuntime({ type: 'agent', id: 'a1', sessionId: 's1' })

      expect(factory.getRuntime('agent', 'a1', 's1')).toBeDefined()
      expect(factory.getRuntime('agent', 'a1', 's2')).toBeNull()
    })
  })

  // ===== destroyRuntime =====

  describe('destroyRuntime', () => {
    it('销毁运行时并从缓存移除', async () => {
      await factory.createRuntime({ type: 'agent', id: 'a1' })

      await factory.destroyRuntime('agent', 'a1')

      expect(mockAgentDestroy).toHaveBeenCalledOnce()
      expect(factory.getRuntime('agent', 'a1')).toBeNull()
    })

    it('销毁不存在的运行时不报错', async () => {
      await expect(factory.destroyRuntime('agent', 'nope')).resolves.toBeUndefined()
    })
  })

  // ===== destroyAll =====

  describe('destroyAll', () => {
    it('销毁所有运行时', async () => {
      await factory.createRuntime({ type: 'agent', id: 'a1' })
      await factory.createRuntime({ type: 'team', id: 't1' })
      await factory.createRuntime({ type: 'swarm', id: 'sw1' })

      await factory.destroyAll()

      expect(mockAgentDestroy).toHaveBeenCalledOnce()
      expect(mockTeamDestroy).toHaveBeenCalledOnce()
      expect(mockSwarmDestroy).toHaveBeenCalledOnce()
      expect(factory.getRuntime('agent', 'a1')).toBeNull()
      expect(factory.getRuntime('team', 't1')).toBeNull()
      expect(factory.getRuntime('swarm', 'sw1')).toBeNull()
    })
  })
})
