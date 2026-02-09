/**
 * AgentFactory 单元测试
 *
 * 测试 Agent 创建和工具注册
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    factory = new AgentFactory()
    vi.clearAllMocks()
  })

  // ========== 创建 Agent ==========

  describe('createAgent', () => {
    it('使用默认预设（chat）创建 Agent', async () => {
      const agent = await factory.createAgent()

      expect(agent).toBeDefined()
      expect(agent.name).toBe('ChatAssistant')
    })

    it('使用指定预设创建 Agent', async () => {
      const agent = await factory.createAgent({ preset: 'code' })

      expect(agent.name).toBe('CodeAssistant')
    })

    it('使用 research 预设创建 Agent', async () => {
      const agent = await factory.createAgent({ preset: 'research' })

      expect(agent.name).toBe('ResearchAssistant')
    })

    it('使用自定义配置覆盖预设', async () => {
      const agent = await factory.createAgent({
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

      const agent = await factory.createAgent({ configId: 'config-1' })

      expect(agentConfigStore.getConfig).toHaveBeenCalledWith('config-1')
      expect(agent.name).toBe('DBAgent')
    })

    it('数据库配置不存在时抛出错误', async () => {
      vi.mocked(agentConfigStore.getConfig).mockResolvedValue(null)

      await expect(factory.createAgent({ configId: 'not-exist' })).rejects.toThrow(
        'Agent config not found: not-exist'
      )
    })

    it('创建 Agent 时注入工具', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockTool = { name: 'test_tool', type: 'function' } as any

      const agent = await factory.createAgent({
        tools: [mockTool]
      })

      expect(agent.tools).toContain(mockTool)
    })

    it('每次调用都返回新实例', async () => {
      const agent1 = await factory.createAgent()
      const agent2 = await factory.createAgent()

      expect(agent1).not.toBe(agent2)
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
})
