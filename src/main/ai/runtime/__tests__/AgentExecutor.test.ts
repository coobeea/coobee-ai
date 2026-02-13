/**
 * AgentExecutor 改进项测试
 *
 * 测试多项改进：
 * - P1: OpenAIBuilder 链式构建
 * - P0: 事件模型统一 — stream/execute 中的 forward() 调用
 * - P2: HITL supportsHITL 属性
 * - P3: getDefaultSessionDir 的容错行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockForward, mockStreamEmitter, mockRuntime } = vi.hoisted(() => {
  const mockForward = vi.fn()
  const mockStreamEmitter = { forward: mockForward }
  const mockRuntime = {
    type: 'agent' as const,
    id: 'agent-1',
    name: 'TestAgent',
    options: { name: 'TestAgent', instructions: 'test' },
    interrupted: false,
    supportsHITL: true,
    initialize: vi.fn(),
    destroy: vi.fn(),
    stream: vi.fn(),
    run: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn(),
    resumeStream: vi.fn()
  }
  return { mockForward, mockStreamEmitter, mockRuntime }
})

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

// ===== Mock StreamEmitter =====
vi.mock('../../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn(() => mockStreamEmitter)
}))

// ===== Mock PiMono runtime =====
vi.mock('../pimono', () => ({
  PiMonoAgentRuntime: class MockPiMonoRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

// ===== Mock OpenAI runtime =====
vi.mock('../openai', () => ({
  OpenAIAgentRuntime: class MockOpenAIRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

import { PiMonoBuilder, OpenAIBuilder } from '../../AgentExecutor'

// ===== Mock env for getDefaultSessionDir =====
vi.mock('@main/common/env', () => {
  throw new Error('Env not available in test')
})

describe('OpenAIBuilder', () => {
  let builder: OpenAIBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    builder = new OpenAIBuilder()
  })

  describe('链式 API', () => {
    it('所有方法返回 this（支持链式调用）', () => {
      const result = builder
        .name('test-agent')
        .instructions('你好')
        .model('gpt-4o')
        .sessionId('s1')
        .sessionDir('/tmp/sessions')
        .maxTurns(10)
        .appendInstructions('extra1', 'extra2')
        .tools([])
        .skills([])
        .sdkTools([])
        .handoffs([])
        .modelSettings({ temperature: 0.7 })
        .compression({ enabled: true })

      expect(result).toBe(builder)
    })
  })

  describe('build()', () => {
    it('构建并返回初始化后的 Runtime', async () => {
      mockRuntime.initialize.mockResolvedValue(undefined)

      const runtime = await builder
        .name('openai-agent')
        .instructions('Test instructions')
        .model('gpt-4o')
        .sessionId('session-1')
        .build()

      expect(runtime).toBeDefined()
      expect(mockRuntime.initialize).toHaveBeenCalled()
    })
  })
})

describe('PiMonoBuilder', () => {
  let builder: PiMonoBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    // 设置必要的环境变量
    process.env.VITE_LLM_API_KEY = 'test-key'
    builder = new PiMonoBuilder()
  })

  describe('链式 API', () => {
    it('所有方法返回 this', () => {
      const result = builder
        .name('pi-agent')
        .instructions('你好')
        .model('MiniMax-M2.1')
        .sessionMode('file')
        .sessionDir('/tmp')
        .thinkingLevel('medium')
        .compaction({ enabled: true })
        .retry({ enabled: true, maxRetries: 3 })

      expect(result).toBe(builder)
    })
  })
})

describe('AgentExecutor — Executor 集成', () => {
  // 导入需要在 mock 之后
  let agentExecutor: typeof import('../../AgentExecutor').agentExecutor

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../AgentExecutor')
    agentExecutor = mod.agentExecutor
  })

  describe('工厂方法', () => {
    it('piMono() 返回 PiMonoBuilder', () => {
      const builder = agentExecutor.piMono()
      expect(builder).toBeInstanceOf(PiMonoBuilder)
    })

    it('openai() 返回 OpenAIBuilder', () => {
      const builder = agentExecutor.openai()
      expect(builder).toBeInstanceOf(OpenAIBuilder)
    })
  })

  describe('stream() 中的 forward 调用', () => {
    it('每个 chunk 都通过 StreamEmitter.forward() 广播', async () => {
      // 模拟 runtime.stream() 返回的 generator
      const chunks = [
        { type: 'run:start', content: '' },
        { type: 'text:delta', content: 'hello' },
        { type: 'run:done', content: '' }
      ]
      const result = { output: 'hello', duration: 100 }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function* mockStreamGen(): AsyncGenerator<any, any, unknown> {
        for (const c of chunks) yield c
        return result
      }

      mockRuntime.stream.mockReturnValue(mockStreamGen())
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      process.env.VITE_LLM_API_KEY = 'test-key'
      const builder = agentExecutor.piMono().name('test').sessionId('session-test')

      const gen = agentExecutor.stream({
        sessionId: 'session-test',
        message: 'hello',
        builder
      })

      const collected: unknown[] = []
      let r = await gen.next()
      while (!r.done) {
        collected.push(r.value)
        r = await gen.next()
      }

      // forward 被调用了 3 次（每个 chunk 一次）
      expect(mockForward).toHaveBeenCalledTimes(3)
      expect(collected).toHaveLength(3)
    })
  })
})
