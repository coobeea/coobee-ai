/**
 * AgentExecutor HITL 循环测试
 *
 * 测试 execute() 中 Promise 等待模式的 HITL 循环：
 * - 正常审批流程（interrupted → wait → decide → resume → done）
 * - 超时处理
 * - 多轮中断（resume 后再次 interrupted）
 * - 混合决策（approve + reject）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExecutionResult, StreamChunk } from '../../runtime/types'

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
  }
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

describe('AgentExecutor — HITL 循环', () => {
  let agentExecutor: typeof import('../../AgentExecutor').agentExecutor
  let hitlApprovalManager: typeof import('../HitlApprovalManager').hitlApprovalManager

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITE_LLM_API_KEY = 'test-key'

    const mod = await import('../../AgentExecutor')
    agentExecutor = mod.agentExecutor
    const hitlMod = await import('../HitlApprovalManager')
    hitlApprovalManager = hitlMod.hitlApprovalManager
  })

  afterEach(() => {
    hitlApprovalManager.cleanupAll()
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

  it('无 HITL 中断时正常执行', async () => {
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
    expect(mockRuntime.approveToolCall).not.toHaveBeenCalled()
  })

  it('HITL 中断 → 审批 → 恢复 → 完成', async () => {
    // Phase 1: 初始 stream 返回 interrupted
    const interruptedResult: ExecutionResult = {
      output: '',
      interrupted: true,
      interruptions: [{ index: 0, toolName: 'exec', arguments: '{"cmd":"rm -rf /"}' }]
    }
    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          {
            type: 'hitl:required',
            content: 'exec',
            data: { index: 0, toolName: 'exec', arguments: '{"cmd":"rm -rf /"}', approvalItem: {} }
          }
        ],
        interruptedResult
      )
    )

    // Phase 2: resume 返回正常结果
    const resumeResult: ExecutionResult = { output: 'done after approval', duration: 200 }
    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'text:delta', content: 'done after approval' },
          { type: 'run:done', content: '' }
        ],
        resumeResult
      )
    )

    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('test').sessionId('session-hitl')

    // 启动执行（submit 模式，非阻塞）
    const submitResult = agentExecutor.submit({
      sessionId: 'session-hitl',
      message: 'dangerous command',
      builder
    })
    expect(submitResult.status).toBe('accepted')

    // 等待一下让异步任务开始执行到 await waitForDecisions
    await vi.advanceTimersByTimeAsync(10)

    // 前端提交审批决策
    const decided = hitlApprovalManager.submitDecision('session-hitl', 0, 'approve-once')
    expect(decided).toBe(true)

    // 让异步任务继续执行
    await vi.advanceTimersByTimeAsync(10)

    // 验证 approve 被调用
    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
    // 验证 resume 被调用
    expect(mockRuntime.resumeStream).toHaveBeenCalled()
    // 验证 forward 被调用（包含 run:interrupted 事件）
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:interrupted' }))
  })

  it('HITL 超时 → 返回 timeout 结果', async () => {
    const interruptedResult: ExecutionResult = {
      output: '',
      interrupted: true,
      interruptions: [{ index: 0, toolName: 'exec', arguments: '{}' }]
    }
    mockRuntime.stream.mockReturnValue(
      createStreamGen([{ type: 'hitl:required', content: 'exec' }], interruptedResult)
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('test').sessionId('session-timeout')

    agentExecutor.submit({
      sessionId: 'session-timeout',
      message: 'will timeout',
      builder
    })

    // 等待异步任务到达 waitForDecisions
    await vi.advanceTimersByTimeAsync(10)

    // 不提交决策，推进到超时
    await vi.advanceTimersByTimeAsync(120_000 + 100)

    // 验证 forward 了 run:error 超时事件
    expect(mockForward).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run:error',
        content: 'HITL approval timeout'
      })
    )

    // 验证 runtime 被销毁
    expect(mockRuntime.destroy).toHaveBeenCalled()
  })

  it('reject 决策调用 rejectToolCall', async () => {
    const interruptedResult: ExecutionResult = {
      output: '',
      interrupted: true,
      interruptions: [{ index: 0, toolName: 'dangerous_tool', arguments: '{}' }]
    }
    mockRuntime.stream.mockReturnValue(createStreamGen([], interruptedResult))

    const resumeResult: ExecutionResult = { output: 'rejected', duration: 50 }
    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen([{ type: 'run:done', content: '' }], resumeResult)
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('test').sessionId('session-reject')

    agentExecutor.submit({
      sessionId: 'session-reject',
      message: 'reject this',
      builder
    })

    await vi.advanceTimersByTimeAsync(10)

    hitlApprovalManager.submitDecision('session-reject', 0, 'reject')

    await vi.advanceTimersByTimeAsync(10)

    expect(mockRuntime.rejectToolCall).toHaveBeenCalledWith(0)
    expect(mockRuntime.approveToolCall).not.toHaveBeenCalled()
  })

  it('approve-always 传递 alwaysApprove: true', async () => {
    const interruptedResult: ExecutionResult = {
      output: '',
      interrupted: true,
      interruptions: [{ index: 0, toolName: 'safe_tool', arguments: '{}' }]
    }
    mockRuntime.stream.mockReturnValue(createStreamGen([], interruptedResult))

    const resumeResult: ExecutionResult = { output: 'ok', duration: 50 }
    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen([{ type: 'run:done', content: '' }], resumeResult)
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('test').sessionId('session-always')

    agentExecutor.submit({
      sessionId: 'session-always',
      message: 'approve always',
      builder
    })

    await vi.advanceTimersByTimeAsync(10)

    hitlApprovalManager.submitDecision('session-always', 0, 'approve-always')

    await vi.advanceTimersByTimeAsync(10)

    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: true })
  })
})
