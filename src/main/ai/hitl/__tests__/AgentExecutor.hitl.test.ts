/**
 * AgentExecutor 基础测试
 *
 * HITL 审批逻辑已从 AgentExecutor 移至 tool-approval Extension（before_tool_call Hook）。
 * 此文件仅测试 AgentExecutor 的基本执行流程。
 *
 * HITL 相关测试应在 tool-approval Extension 的测试中覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExecutionResult, StreamChunk } from '../../runtime/types'

// ===== Hoisted mocks =====
const { mockStreamEmitter, mockRuntime } = vi.hoisted(() => {
  const mockForward = vi.fn()
  const mockStreamEmitter = { forward: mockForward }
  const mockRuntime = {
    type: 'agent' as const,
    id: 'agent-1',
    name: 'TestAgent',
    options: { name: 'TestAgent', instructions: 'test' },
    interrupted: false,
    supportsHITL: false,
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
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
  setLevel: vi.fn(),
  setConsoleLevel: vi.fn()
}))
vi.mock('@main/common/logger', () => ({
  log: mockLog,
  createLogger: () => mockLog
}))

// ===== Mock StreamEmitter =====
vi.mock('../../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn(() => mockStreamEmitter)
}))

// ===== Mock PiMono runtime =====
vi.mock('../../runtime/pimono', () => ({
  PiMonoAgentRuntime: class MockPiMonoRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

// ===== Mock env =====
vi.mock('@main/common/env', () => {
  throw new Error('Env not available in test')
})

describe('AgentExecutor — 基础执行', () => {
  let agentExecutor: typeof import('../../AgentExecutor').agentExecutor

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITE_LLM_API_KEY = 'test-key'

    const mod = await import('../../AgentExecutor')
    agentExecutor = mod.agentExecutor
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** 辅助：创建 stream generator */
  function createStreamGen(
    chunks: StreamChunk[],
    result: ExecutionResult
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): AsyncGenerator<StreamChunk, ExecutionResult, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function* gen(): AsyncGenerator<StreamChunk, ExecutionResult, any> {
      for (const c of chunks) yield c
      return result
    }
    return gen()
  }

  it('正常执行：stream → forward → done', async () => {
    const normalResult: ExecutionResult = { output: 'hello', duration: 100 }
    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          { type: 'text:delta', content: 'hello' },
          { type: 'run:done', content: '' }
        ],
        normalResult
      )
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('test').sessionId('session-normal')
    const result = await agentExecutor.submitAndWait({
      sessionId: 'session-normal',
      message: 'hi',
      builder
    })

    expect(result.output).toBe('hello')
    expect(mockRuntime.destroy).toHaveBeenCalled()
    // HITL 不再由 AgentExecutor 管理
    expect(mockRuntime.approveToolCall).not.toHaveBeenCalled()
    expect(mockRuntime.resumeStream).not.toHaveBeenCalled()
  })

  it('并发控制：同一 session 重复 submit 返回 busy', async () => {
    mockRuntime.stream.mockReturnValue(
      createStreamGen([{ type: 'run:start', content: '' }], { output: 'ok', duration: 100 })
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder1 = agentExecutor.piMono().name('test').sessionId('session-busy')
    agentExecutor.submit({ sessionId: 'session-busy', message: 'first', builder: builder1 })

    const builder2 = agentExecutor.piMono().name('test').sessionId('session-busy')
    const result = agentExecutor.submit({
      sessionId: 'session-busy',
      message: 'second',
      builder: builder2
    })

    expect(result.status).toBe('busy')
  })
})
