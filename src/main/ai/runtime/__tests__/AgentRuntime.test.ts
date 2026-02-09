/**
 * AgentRuntime 单元测试
 *
 * SDK 合规改进后的测试：
 * - run() 带 maxTurns 和 previousResponseId
 * - runStream() 使用 stream: true 返回 async iterable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 创建模拟的 StreamedRunResult（async iterable）
 * 用于测试 runStream() 的流式事件消费
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
  const asyncIterable = {
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
    // StreamedRunResult.completed 返回 Promise<void>
    completed: Promise.resolve(),
    // 属性在 streamResult 自身上（继承自 RunResultBase）
    finalOutput: 'streamed output',
    lastResponseId: 'resp_stream_mock',
    newItems: []
  }
  return asyncIterable
}

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
    // 根据 stream 选项返回不同类型
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
      instructions: 'test',
      model: 'gpt-4o',
      tools: ['tool1'],
      skills: ['skill1']
    })
  }
}))

vi.mock('../../agents/AgentFactory', () => ({
  agentFactory: {
    createAgent: vi.fn().mockResolvedValue({
      name: 'TestAgent',
      instructions: 'test',
      tools: []
    })
  }
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

import { AgentRuntime } from '../AgentRuntime'
import { run } from '@openai/agents'

describe('AgentRuntime', () => {
  let runtime: AgentRuntime

  beforeEach(async () => {
    vi.clearAllMocks()
    runtime = new AgentRuntime('agent-1', 'session-1')
    await runtime.initialize()
  })

  describe('initialize', () => {
    it('加载配置并创建 Agent', () => {
      expect(runtime.name).toBe('TestAgent')
      expect(runtime.type).toBe('agent')
    })
  })

  describe('run', () => {
    it('调用 SDK run() 并返回结果', async () => {
      const result = await runtime.run('hello')

      expect(run).toHaveBeenCalled()
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

      // runStream 使用 stream: true，消费 async iterable 事件
      expect(result.output).toBe('streamed output')
      // 至少有 text delta 和 done 事件
      expect(chunks.length).toBeGreaterThanOrEqual(2)
      expect(chunks[chunks.length - 1].type).toBe('done')
    })

    it('流式执行调用 run() 时传入 stream: true', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunks: any[] = []
      await runtime.runStream('hello', {}, (chunk) => chunks.push(chunk))

      expect(run).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.objectContaining({ stream: true, maxTurns: expect.any(Number) })
      )
    })
  })

  describe('工具管理', () => {
    it('getTools 返回工具列表', () => {
      const tools = runtime.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('tool1')
      expect(tools[0].enabled).toBe(true)
    })

    it('setToolEnabled 更新工具状态', () => {
      runtime.setToolEnabled('tool1', false)
      const tools = runtime.getTools()
      expect(tools.find((t) => t.name === 'tool1')?.enabled).toBe(false)
    })
  })

  describe('技能管理', () => {
    it('getSkills 返回技能列表', () => {
      const skills = runtime.getSkills()
      expect(skills).toHaveLength(1)
      expect(skills[0].id).toBe('skill1')
    })

    it('setSkillActive 更新技能状态', () => {
      runtime.setSkillActive('skill1', false)
      const skills = runtime.getSkills()
      expect(skills.find((s) => s.id === 'skill1')?.active).toBe(false)
    })
  })

  describe('destroy', () => {
    it('清理资源', async () => {
      await runtime.destroy()
      expect(runtime.getTools()).toHaveLength(0)
      expect(runtime.getSkills()).toHaveLength(0)
    })
  })
})
