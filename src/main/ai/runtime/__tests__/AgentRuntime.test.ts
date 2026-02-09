/**
 * AgentRuntime 单元测试
 *
 * 全能力串联后的测试：
 * - SessionFileManager + SessionMemoryStore + SessionAdapter 会话记忆链路
 * - SkillManager 技能激活和 prompt 注入
 * - AgentFactory.getToolsByIds() 工具实例解析
 * - SDK run() 的 session 参数
 * - maxTurns 和 previousResponseId
 * - runStream() 使用 stream: true 返回 async iterable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 创建模拟的 StreamedRunResult（async iterable）
 */
function createMockStreamResult(events: Array<Record<string, unknown>> = []): {
  [Symbol.asyncIterator]: () => {
    next: () => Promise<{ value: Record<string, unknown> | undefined; done: boolean }>
  }
  completed: Promise<void>
  finalOutput: string
  lastResponseId: string
  newItems: unknown[]
} {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0
      return {
        next: async () => {
          if (index < events.length) {
            return { value: events[index++], done: false }
          }
          return { value: undefined, done: true }
        }
      }
    },
    completed: Promise.resolve(),
    finalOutput: 'streamed output',
    lastResponseId: 'resp_stream_mock',
    newItems: []
  }
}

// ========== 使用 vi.hoisted 定义 mock 对象（在 vi.mock 工厂中可安全引用） ==========

const {
  mockSessionFileManager,
  mockSessionMemoryStore,
  mockSessionAdapter,
  mockSkillManagerInstance
} = vi.hoisted(() => ({
  mockSessionFileManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getBasePath: vi.fn().mockReturnValue('/mock/sessions/session-1'),
    getSessionId: vi.fn().mockReturnValue('session-1'),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue([])
  },
  mockSessionMemoryStore: {
    initialize: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({
      total: 0,
      byRole: {},
      timeRange: null
    }),
    clearHistory: vi.fn().mockResolvedValue(undefined)
  },
  mockSessionAdapter: {
    getSessionId: vi.fn().mockResolvedValue('session-1'),
    getItems: vi.fn().mockResolvedValue([]),
    addItems: vi.fn().mockResolvedValue(undefined),
    popItem: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined)
  },
  mockSkillManagerInstance: {
    registerAll: vi.fn(),
    getSkill: vi.fn().mockReturnValue({
      id: 'web-research',
      name: 'Web Research',
      description: 'Web research skill',
      keywords: ['search'],
      execute: vi.fn()
    }),
    generatePromptSection: vi.fn().mockReturnValue('\n\n## Skills\nWeb Research activated.\n')
  }
}))

// ========== Mocks ==========

vi.mock('@openai/agents', () => ({
  Agent: class {
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(c: any) {
      this.name = c.name || 'mock'
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: vi.fn().mockImplementation((_agent: any, _input: any, options?: any) => {
    if (options?.stream) {
      return Promise.resolve(
        createMockStreamResult([
          {
            type: 'raw_model_stream_event',
            data: { type: 'output_text_delta', delta: 'streamed output' }
          }
        ])
      )
    }
    return Promise.resolve({
      finalOutput: 'mocked output',
      newItems: [],
      history: [],
      lastResponseId: 'resp_mock'
    })
  })
}))

vi.mock('../../storage/AgentConfigStore', () => ({
  agentConfigStore: {
    getConfig: vi.fn().mockResolvedValue({
      id: 'agent-1',
      name: 'TestAgent',
      instructions: 'You are a test agent.',
      model: 'gpt-4o',
      tools: ['tool1'],
      skills: ['web-research'],
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    })
  }
}))

vi.mock('../../agents/AgentFactory', () => ({
  agentFactory: {
    createAgent: vi.fn().mockResolvedValue({
      name: 'TestAgent',
      instructions: 'test',
      tools: []
    }),
    getToolsByIds: vi.fn().mockReturnValue([{ name: 'tool1', description: 'Test tool' }])
  }
}))

vi.mock('../../storage/SessionFileManager', () => ({
  getSessionFileManager: vi.fn().mockReturnValue(mockSessionFileManager),
  SessionFileManager: class {}
}))

vi.mock('../../memory', () => ({
  // 使用 function（非箭头函数）以支持 new 调用
  SessionMemoryStore: vi.fn().mockImplementation(function () {
    return mockSessionMemoryStore
  }),
  createSessionAdapter: vi.fn().mockReturnValue(mockSessionAdapter)
}))

vi.mock('../../skills', () => ({
  // 使用 function（非箭头函数）以支持 new 调用
  SkillManager: vi.fn().mockImplementation(function () {
    return mockSkillManagerInstance
  }),
  builtinSkills: [
    {
      id: 'web-research',
      name: 'Web Research',
      description: 'Web research skill',
      keywords: ['search'],
      execute: vi.fn()
    }
  ]
}))

vi.mock('../../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn().mockReturnValue({
    emitStart: vi.fn().mockResolvedValue(undefined),
    emitDone: vi.fn().mockResolvedValue(undefined),
    emitText: vi.fn().mockResolvedValue(undefined),
    emitThinking: vi.fn().mockResolvedValue(undefined),
    emitError: vi.fn().mockResolvedValue(undefined),
    emitToolCall: vi.fn().mockResolvedValue(undefined),
    emitToolResult: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined)
  })
}))

// ========== Import after mocks ==========

import { AgentRuntime } from '../AgentRuntime'
import { run } from '@openai/agents'
import { agentFactory } from '../../agents/AgentFactory'
import { getSessionFileManager } from '../../storage/SessionFileManager'
import { SessionMemoryStore, createSessionAdapter } from '../../memory'
import { SkillManager } from '../../skills'

describe('AgentRuntime', () => {
  let runtime: AgentRuntime

  beforeEach(async () => {
    vi.clearAllMocks()
    // 重置 mock 返回值
    mockSessionMemoryStore.getStats.mockResolvedValue({
      total: 0,
      byRole: {},
      timeRange: null
    })
    mockSessionMemoryStore.getHistory.mockResolvedValue([])
    runtime = new AgentRuntime('agent-1', 'session-1')
    await runtime.initialize()
  })

  describe('initialize', () => {
    it('加载配置并创建 Agent', () => {
      expect(runtime.name).toBe('TestAgent')
      expect(runtime.type).toBe('agent')
    })

    it('初始化会话记忆链路', () => {
      // SessionFileManager
      expect(getSessionFileManager).toHaveBeenCalledWith('session-1')
      expect(mockSessionFileManager.initialize).toHaveBeenCalled()

      // SessionMemoryStore
      expect(SessionMemoryStore).toHaveBeenCalledWith(mockSessionFileManager, 'session-1')
      expect(mockSessionMemoryStore.initialize).toHaveBeenCalled()

      // SessionAdapter
      expect(createSessionAdapter).toHaveBeenCalledWith(mockSessionMemoryStore, 'session-1')
    })

    it('解析工具实例', () => {
      expect(agentFactory.getToolsByIds).toHaveBeenCalledWith(['tool1'])
    })

    it('激活技能并注入 prompt', () => {
      expect(SkillManager).toHaveBeenCalled()
      expect(mockSkillManagerInstance.registerAll).toHaveBeenCalled()
      expect(mockSkillManagerInstance.getSkill).toHaveBeenCalledWith('web-research')
      expect(mockSkillManagerInstance.generatePromptSection).toHaveBeenCalled()
    })

    it('创建 Agent 时传入工具和技能注入的 instructions', () => {
      expect(agentFactory.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            name: 'TestAgent',
            instructions: expect.stringContaining('You are a test agent.')
          }),
          tools: expect.arrayContaining([expect.objectContaining({ name: 'tool1' })])
        })
      )
    })
  })

  describe('run', () => {
    it('调用 SDK run() 并传入 session 参数', async () => {
      const result = await runtime.run('hello')

      expect(run).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.objectContaining({
          session: expect.any(Object),
          maxTurns: expect.any(Number)
        })
      )
      expect(result.output).toBe('mocked output')
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.metadata).toEqual(
        expect.objectContaining({ agentId: 'agent-1', sessionId: 'session-1' })
      )
    })

    it('SDK 调用失败时抛出错误', async () => {
      vi.mocked(run).mockRejectedValueOnce(new Error('API error'))
      await expect(runtime.run('fail')).rejects.toThrow('API error')
    })
  })

  describe('runStream', () => {
    it('使用 SDK 流式 API 发射事件并返回结果', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunks: any[] = []
      const result = await runtime.runStream('hello', {}, (chunk) => chunks.push(chunk))

      expect(result.output).toBe('streamed output')
      expect(chunks.length).toBeGreaterThanOrEqual(2)
      expect(chunks[chunks.length - 1].type).toBe('done')
    })

    it('流式执行调用 run() 时传入 stream: true 和 session', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunks: any[] = []
      await runtime.runStream('hello', {}, (chunk) => chunks.push(chunk))

      expect(run).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.objectContaining({
          stream: true,
          session: expect.any(Object),
          maxTurns: expect.any(Number)
        })
      )
    })
  })

  describe('会话管理', () => {
    it('getSession 返回会话信息（从 SessionMemoryStore 获取）', async () => {
      mockSessionMemoryStore.getStats.mockResolvedValue({
        total: 5,
        byRole: { user: 3, assistant: 2 },
        timeRange: { start: 1700000000000, end: 1700000100000 }
      })

      const session = await runtime.getSession()
      expect(session.sessionId).toBe('session-1')
      expect(session.messageCount).toBe(5)
      expect(session.metadata).toEqual(
        expect.objectContaining({
          agentId: 'agent-1',
          agentName: 'TestAgent',
          byRole: { user: 3, assistant: 2 }
        })
      )
    })

    it('clearSession 清除 SessionMemoryStore 历史', async () => {
      await runtime.clearSession()
      expect(mockSessionMemoryStore.clearHistory).toHaveBeenCalled()
    })
  })

  describe('记忆管理', () => {
    it('getMemory 返回记忆摘要（从 SessionMemoryStore 获取）', async () => {
      mockSessionMemoryStore.getStats.mockResolvedValue({
        total: 10,
        byRole: { user: 5, assistant: 5 },
        timeRange: { start: 1700000000000, end: 1700000100000 }
      })
      mockSessionMemoryStore.getHistory.mockResolvedValue([
        { role: 'user', content: 'hello', timestamp: 1700000000000 },
        { role: 'assistant', content: 'Hi! How can I help?', timestamp: 1700000001000 }
      ])

      const memory = await runtime.getMemory()
      expect(memory.shortTermCount).toBe(10)
      expect(memory.recentKeyPoints).toHaveLength(1) // only assistant messages
      expect(memory.recentKeyPoints![0]).toBe('Hi! How can I help?')
    })

    it('clearMemory 清除 SessionMemoryStore 历史', async () => {
      await runtime.clearMemory()
      expect(mockSessionMemoryStore.clearHistory).toHaveBeenCalled()
    })

    it('saveMemory 不手动保存（SDK Session 自动管理）', async () => {
      await runtime.saveMemory()
      // SessionMemoryStore.appendMessage 不应被直接调用
      expect(mockSessionMemoryStore.appendMessage).not.toHaveBeenCalled()
    })
  })

  describe('工具管理', () => {
    it('getTools 返回已解析的工具列表', () => {
      const tools = runtime.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('tool1')
      expect(tools[0].enabled).toBe(true)
    })

    it('setToolEnabled 更新工具状态并触发 Agent 重建', () => {
      runtime.setToolEnabled('tool1', false)
      const tools = runtime.getTools()
      expect(tools.find((t) => t.name === 'tool1')?.enabled).toBe(false)
      // rebuildAgent 被异步调用
      expect(agentFactory.createAgent).toHaveBeenCalledTimes(2) // initialize + rebuild
    })
  })

  describe('技能管理', () => {
    it('getSkills 返回技能列表（从 SkillManager 获取详情）', () => {
      const skills = runtime.getSkills()
      expect(skills).toHaveLength(1)
      expect(skills[0].id).toBe('web-research')
      expect(skills[0].name).toBe('Web Research')
      expect(skills[0].active).toBe(true)
    })

    it('setSkillActive 更新技能状态并触发 Agent 重建', () => {
      runtime.setSkillActive('web-research', false)
      const skills = runtime.getSkills()
      expect(skills.find((s) => s.id === 'web-research')?.active).toBe(false)
      // rebuildAgent 被异步调用
      expect(agentFactory.createAgent).toHaveBeenCalledTimes(2) // initialize + rebuild
    })
  })

  describe('destroy', () => {
    it('清理所有资源', async () => {
      await runtime.destroy()
      expect(runtime.getTools()).toHaveLength(0)
      expect(runtime.getSkills()).toHaveLength(0)
    })
  })
})
