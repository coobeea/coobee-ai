/**
 * AgentFactory 单元测试
 *
 * 测试 Agent 创建、缓存（LRU）、工具注册和销毁
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @openai/agents SDK
vi.mock('@openai/agents', () => {
  class MockAgent {
    name: string
    instructions: string
    tools: unknown[]
    handoffs: unknown[]
    model?: string
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config)
      this.name = (config.name as string) || 'MockAgent'
      this.instructions = (config.instructions as string) || ''
      this.tools = (config.tools as unknown[]) || []
      this.handoffs = (config.handoffs as unknown[]) || []
    }
  }
  return { Agent: MockAgent }
})

// Mock AgentConfigStore
vi.mock('../../storage/AgentConfigStore', () => ({
  agentConfigStore: {
    getConfig: vi.fn()
  }
}))

import { AgentFactory } from '../AgentFactory'
import { agentConfigStore } from '../../storage/AgentConfigStore'

describe('AgentFactory', () => {
  let factory: AgentFactory

  beforeEach(() => {
    vi.useFakeTimers()
    factory = new AgentFactory()
  })

  afterEach(() => {
    factory.destroy()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ========== 创建 Agent ==========

  describe('createAgent', () => {
    it('使用默认预设（chat）创建 Agent', async () => {
      const agent = await factory.createAgent('session-1')

      expect(agent).toBeDefined()
      expect(agent.name).toBe('ChatAssistant')
    })

    it('使用指定预设创建 Agent', async () => {
      const agent = await factory.createAgent('session-2', { preset: 'code' })

      expect(agent.name).toBe('CodeAssistant')
    })

    it('使用 research 预设创建 Agent', async () => {
      const agent = await factory.createAgent('session-3', { preset: 'research' })

      expect(agent.name).toBe('ResearchAssistant')
    })

    it('使用自定义配置覆盖预设', async () => {
      const agent = await factory.createAgent('session-4', {
        preset: 'chat',
        config: { name: 'CustomAgent', model: 'gpt-4o-mini' }
      })

      expect(agent.name).toBe('CustomAgent')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((agent as any).model).toBe('gpt-4o-mini')
    })

    it('从数据库配置创建 Agent', async () => {
      vi.mocked(agentConfigStore.getConfig).mockResolvedValue({
        id: 'config-1',
        name: 'DBAgent',
        instructions: 'DB instructions',
        model: 'gpt-4o-mini',
        tools: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const agent = await factory.createAgent('session-5', { configId: 'config-1' })

      expect(agentConfigStore.getConfig).toHaveBeenCalledWith('config-1')
      expect(agent.name).toBe('DBAgent')
    })

    it('数据库配置不存在时抛出错误', async () => {
      vi.mocked(agentConfigStore.getConfig).mockResolvedValue(null)

      await expect(factory.createAgent('session-6', { configId: 'not-exist' })).rejects.toThrow(
        'Agent config not found: not-exist'
      )
    })

    it('创建 Agent 时注入工具', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockTool = { name: 'test_tool', type: 'function' } as any

      const agent = await factory.createAgent('session-7', {
        tools: [mockTool]
      })

      expect(agent.tools).toContain(mockTool)
    })
  })

  // ========== 缓存逻辑 ==========

  describe('缓存逻辑', () => {
    it('创建后缓存 Agent', async () => {
      await factory.createAgent('session-cache-1')

      const cached = factory.getAgent('session-cache-1')
      expect(cached).toBeDefined()
      expect(cached!.name).toBe('ChatAssistant')
    })

    it('获取不存在的 Agent 返回 undefined', () => {
      const agent = factory.getAgent('not-exist')
      expect(agent).toBeUndefined()
    })

    it('getOrCreateAgent 已存在时返回缓存', async () => {
      const first = await factory.createAgent('session-oc', { preset: 'code' })

      const second = await factory.getOrCreateAgent('session-oc')
      expect(second.name).toBe('CodeAssistant')
      // 应该是同一个实例
      expect(second).toBe(first)
    })

    it('getOrCreateAgent 不存在时新建', async () => {
      const agent = await factory.getOrCreateAgent('session-oc2', { preset: 'research' })
      expect(agent.name).toBe('ResearchAssistant')
    })

    it('过期的 Agent 被清理', async () => {
      await factory.createAgent('session-expire')

      // 前进 31 分钟
      vi.advanceTimersByTime(31 * 60 * 1000)

      const agent = factory.getAgent('session-expire')
      expect(agent).toBeUndefined()
    })

    it('访问 Agent 会刷新过期时间', async () => {
      await factory.createAgent('session-refresh')

      // 前进 20 分钟
      vi.advanceTimersByTime(20 * 60 * 1000)

      // 访问一次
      const agent1 = factory.getAgent('session-refresh')
      expect(agent1).toBeDefined()

      // 再前进 20 分钟（总共 40 分钟，但上次访问只有 20 分钟）
      vi.advanceTimersByTime(20 * 60 * 1000)

      const agent2 = factory.getAgent('session-refresh')
      expect(agent2).toBeDefined()
    })

    it('LRU 淘汰最久未使用的 Agent', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maxSize = (factory as any).maxCacheSize as number

      for (let i = 0; i < maxSize; i++) {
        await factory.createAgent(`session-lru-${i}`)
      }

      // 创建第 maxSize + 1 个应该触发淘汰
      await factory.createAgent(`session-lru-${maxSize}`)

      // 第一个应该被淘汰
      const evicted = factory.getAgent('session-lru-0')
      expect(evicted).toBeUndefined()

      // 最后一个应该存在
      const last = factory.getAgent(`session-lru-${maxSize}`)
      expect(last).toBeDefined()
    })
  })

  // ========== 工具注册 ==========

  describe('工具注册', () => {
    it('registerTool 注册单个工具', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockTool = { name: 'tool_1', type: 'function' } as any
      factory.registerTool('tool_1', mockTool)

      expect(factory.getTool('tool_1')).toBe(mockTool)
    })

    it('registerTools 批量注册工具', () => {
      const tools = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_a: { name: 'tool_a' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_b: { name: 'tool_b' } as any
      }
      factory.registerTools(tools)

      expect(factory.getTool('tool_a')).toBe(tools.tool_a)
      expect(factory.getTool('tool_b')).toBe(tools.tool_b)
    })

    it('getTool 未注册工具返回 undefined', () => {
      expect(factory.getTool('not-exist')).toBeUndefined()
    })

    it('getToolsByIds 返回匹配的工具', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolA = { name: 'a' } as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolB = { name: 'b' } as any
      factory.registerTool('a', toolA)
      factory.registerTool('b', toolB)

      const result = factory.getToolsByIds(['a', 'b', 'c'])
      expect(result).toEqual([toolA, toolB])
    })
  })

  // ========== 删除和清理 ==========

  describe('删除和清理', () => {
    it('removeAgent 删除 Agent', async () => {
      await factory.createAgent('session-rm')
      factory.removeAgent('session-rm')

      expect(factory.getAgent('session-rm')).toBeUndefined()
    })

    it('clear 清空所有 Agent', async () => {
      await factory.createAgent('session-c1')
      await factory.createAgent('session-c2')
      factory.clear()

      expect(factory.getAllSessionIds()).toHaveLength(0)
    })

    it('getAllSessionIds 返回所有会话 ID', async () => {
      await factory.createAgent('s1')
      await factory.createAgent('s2')
      await factory.createAgent('s3')

      const ids = factory.getAllSessionIds()
      expect(ids).toHaveLength(3)
      expect(ids).toContain('s1')
      expect(ids).toContain('s2')
      expect(ids).toContain('s3')
    })

    it('destroy 清理定时器和所有 Agent', async () => {
      await factory.createAgent('session-destroy')
      factory.destroy()

      expect(factory.getAllSessionIds()).toHaveLength(0)
    })
  })
})
