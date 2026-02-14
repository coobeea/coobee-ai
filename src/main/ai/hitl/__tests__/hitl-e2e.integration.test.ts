/**
 * HITL 全链路集成测试
 *
 * 测试完整的 HITL 审批流程，不 mock StreamEmitter 和 EventBus：
 *
 *   AgentExecutor.submit()
 *     → runtime.stream() 产生 hitl:required
 *     → StreamEmitter.forward() 广播到 EventBus
 *     → AgentExecutor 进入 HITL 等待
 *     → [模拟前端] 通过 Gateway hitl.decide 提交决策
 *     → HitlApprovalManager resolve Promise
 *     → AgentExecutor 恢复 → runtime.resumeStream()
 *     → StreamEmitter.forward() 继续广播
 *     → 完成
 *
 * 验证内容：
 *   1. EventBus 收到正确的事件序列（start, hitl, interrupted, resumed, done）
 *   2. Gateway hitl.decide 参数校验和决策转发
 *   3. 多工具审批（需全部审批后才恢复）
 *   4. 超时场景
 *   5. onChunk 回调收到正确的 chunk 序列
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExecutionResult, StreamChunk } from '../../runtime/types'
import { StreamEventType, type StreamEvent, type StreamMessage } from '../../streaming/types'

// ===== 仅 mock runtime 和 env，不 mock StreamEmitter 和 EventBus =====

const mockRuntime = vi.hoisted(() => ({
  type: 'agent' as const,
  id: 'agent-hitl-e2e',
  name: 'HitlTestAgent',
  options: { name: 'HitlTestAgent', instructions: 'test' },
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
}))

// mock logger（防止日志输出影响测试）
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

// mock PiMono runtime 工厂
vi.mock('../../runtime/pimono', () => ({
  PiMonoAgentRuntime: class MockPiMonoRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

// mock Electron env
vi.mock('@main/common/env', () => ({
  Env: {
    isDev: true,
    paths: {
      userHome: '/tmp/test-home',
      temp: '/tmp',
      builtinSkillsDir: '/tmp/test-skills',
      userSkillsDir: '/tmp/test-home/skills',
      memoryDir: '/tmp/test-home/memory',
      userMemoryDir: '/tmp/test-home/memory/user',
      agentMemoryDir: '/tmp/test-home/memory/agent',
      workspacesDir: '/tmp/test-home/workspaces',
      configDir: '/tmp/test-home/config',
      userData: '/tmp/test-userData'
    },
    getAgentWorkspaceDir: async () => '/tmp/test-home/workspaces/test-session',
    getSkillSearchPaths: async () => ['/tmp/test-skills', '/tmp/test-home/skills'],
    getExtensionSearchPaths: async () => []
  }
}))

// mock Extension（避免加载 extension 模块失败）
vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getHookRunner: () => null,
    getRegistry: () => null
  }
}))

// mock AgentEnv helpers（避免文件系统操作）
vi.mock('../../common/AgentEnv', () => ({
  buildAgentEnv: async () => ({
    workspace: '/tmp/test-workspace',
    userHome: '/tmp/test-home',
    temp: '/tmp',
    platform: 'darwin',
    isDev: true,
    skillPaths: [],
    builtinSkillsDir: '/tmp/test-skills',
    userSkillsDir: '/tmp/test-home/skills',
    memoryDir: '/tmp/test-home/memory',
    extensionPaths: []
  }),
  formatRuntimePaths: () => '<runtime_paths>mock</runtime_paths>',
  loadRuntimeEnvSkill: async () => null
}))

// ===== 导入真实模块 =====
import { eventBus } from '@main/common/eventbus'
import { hitlApprovalManager } from '../HitlApprovalManager'
import { approvalMethods } from '@main/gateway/methods/approval'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

/**
 * 辅助函数：模拟通过 Gateway 调用 hitl.decide
 * 封装 Gateway MethodHandler 的调用格式，返回兼容旧 ApprovalApi 的结果格式。
 */
async function callDecide(
  sessionId: string,
  index: number,
  decision: HitlApprovalDecision | string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await approvalMethods.methods.decide(
      { sessionId, index, decision } as Record<string, unknown>,
      // ctx 在 hitl.decide 中未使用，传 null 安全
      null as never
    )
    return result as { ok: boolean; error?: string }
  } catch (err: unknown) {
    // GatewayMethodError → { ok: false, error: message }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

describe('HITL 全链路集成测试', () => {
  let agentExecutor: typeof import('../../AgentExecutor').agentExecutor

  /** 收集 EventBus 上的 StreamMessage 事件 */
  const collectedMessages: StreamMessage[] = []
  /** 收集所有 EventBus 事件类型 */
  const collectedEventTypes: string[] = []

  /** EventBus 监听器 */
  function onStreamMessage(event: StreamEvent): void {
    if (event.message) {
      collectedMessages.push(event.message)
      collectedEventTypes.push(`msg:${event.message.type}`)
    }
  }
  function onStreamStart(event: StreamEvent): void {
    collectedEventTypes.push(`lifecycle:${event.type}`)
  }
  function onStreamEnd(event: StreamEvent): void {
    collectedEventTypes.push(`lifecycle:${event.type}`)
  }
  function onStreamError(event: StreamEvent): void {
    collectedEventTypes.push(`lifecycle:${event.type}`)
  }

  /**
   * 刷新微任务队列
   *
   * submit() 启动的 detached promise 需要多轮微任务刷新才能执行到 HITL 等待点。
   * 原因：build() 内部 await import() 和 await initialize() 各产生一轮微任务。
   * injectEnv() 额外引入 dynamic import + buildAgentEnv 等异步操作。
   */
  async function flushAsync(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1)
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITE_LLM_API_KEY = 'test-key'

    collectedMessages.length = 0
    collectedEventTypes.length = 0

    // 订阅 EventBus
    eventBus.on(StreamEventType.MESSAGE, onStreamMessage)
    eventBus.on(StreamEventType.START, onStreamStart)
    eventBus.on(StreamEventType.END, onStreamEnd)
    eventBus.on(StreamEventType.ERROR, onStreamError)

    const mod = await import('../../AgentExecutor')
    agentExecutor = mod.agentExecutor

    // 预热动态 import 缓存（避免首次 import 的额外微任务延迟）
    await import('../../runtime/pimono')
    await import('../../common/AgentEnv')
    await import('@main/common/env')
  })

  afterEach(() => {
    eventBus.off(StreamEventType.MESSAGE, onStreamMessage)
    eventBus.off(StreamEventType.START, onStreamStart)
    eventBus.off(StreamEventType.END, onStreamEnd)
    eventBus.off(StreamEventType.ERROR, onStreamError)

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

  // ================================================================
  // 场景 1: 完整 HITL 流程 — submit → interrupted → API decide → resume → done
  // ================================================================

  it('完整 HITL 流程：Agent 执行 → 中断 → API 审批 → 恢复 → 完成', async () => {
    const sessionId = 'e2e-hitl-full'

    // Phase 1: 初始 stream → hitl:required → interrupted
    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          { type: 'text:delta', content: '我需要执行一个命令' },
          {
            type: 'hitl:required',
            content: 'shell_exec',
            data: {
              index: 0,
              toolName: 'shell_exec',
              arguments: '{"cmd":"ls -la"}',
              approvalItem: {},
              action: 'required'
            }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [{ index: 0, toolName: 'shell_exec', arguments: '{"cmd":"ls -la"}' }]
        }
      )
    )

    // Phase 2: resume → 正常完成
    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'text:delta', content: '命令执行完成' },
          { type: 'run:done', content: '' }
        ],
        { output: '命令执行完成', duration: 500 }
      )
    )

    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    // === Step 1: Agent 发起执行 ===
    const builder = agentExecutor.piMono().name('hitl-agent').sessionId(sessionId)
    const submitResult = agentExecutor.submit({
      sessionId,
      message: '请执行 ls -la',
      builder
    })
    expect(submitResult.status).toBe('accepted')

    // 等待异步任务到达 HITL 等待点
    await flushAsync()

    // === Step 2: 验证事件序列 — Agent 进入 HITL 等待 ===
    const msgTypes = collectedMessages.map((m) => m.type)
    expect(msgTypes).toContain('start')
    expect(msgTypes).toContain('text')
    expect(msgTypes).toContain('hitl')
    expect(msgTypes).toContain('interrupted')

    // 验证 hitl 消息携带工具信息
    const hitlMsg = collectedMessages.find((m) => m.type === 'hitl')
    expect(hitlMsg).toBeDefined()
    expect(hitlMsg!.data?.toolName).toBe('shell_exec')
    expect(hitlMsg!.data?.action).toBe('required')

    // 验证 HITL 等待中
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(true)

    // === Step 3: 通过 Gateway hitl.decide 提交审批决策（模拟前端调用） ===
    const apiResult = await callDecide(sessionId, 0, 'approve-once')
    expect(apiResult).toEqual({ ok: true })

    // 让异步任务继续（resume 执行）
    await flushAsync()

    // === Step 4: 验证恢复和完成 ===
    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
    expect(mockRuntime.resumeStream).toHaveBeenCalled()

    // 验证完整事件序列
    const finalMsgTypes = collectedMessages.map((m) => m.type)
    expect(finalMsgTypes).toContain('resumed')
    expect(finalMsgTypes).toContain('done')

    // 验证生命周期事件
    expect(collectedEventTypes).toContain('lifecycle:stream:start')
    expect(collectedEventTypes).toContain('lifecycle:stream:end')

    // 验证 runtime 被正常销毁
    expect(mockRuntime.destroy).toHaveBeenCalledTimes(1)

    // 验证 session 不再 busy
    expect(agentExecutor.getStatus(sessionId).busy).toBe(false)
  })

  // ================================================================
  // 场景 2: Gateway hitl.decide 参数校验
  // ================================================================

  describe('Gateway hitl.decide 参数校验', () => {
    it('缺少 sessionId 返回错误', async () => {
      const result = await callDecide('', 0, 'approve-once')
      expect(result).toEqual({ ok: false, error: 'sessionId is required' })
    })

    it('无效 index 返回错误', async () => {
      const result = await callDecide('session-1', -1, 'approve-once')
      expect(result).toEqual({ ok: false, error: 'index must be a non-negative number' })
    })

    it('无效 decision 返回错误', async () => {
      const result = await callDecide('session-1', 0, 'invalid')
      expect(result).toEqual({ ok: false, error: 'Invalid decision: invalid' })
    })

    it('无 pending 时返回错误', async () => {
      const result = await callDecide('no-such-session', 0, 'reject')
      expect(result).toEqual({
        ok: false,
        error: 'No pending approval for this session or invalid index'
      })
    })
  })

  // ================================================================
  // 场景 3: 多工具审批 — 两个工具需要审批，全部通过后才恢复
  // ================================================================

  it('多工具审批：需要全部审批完成后才恢复执行', async () => {
    const sessionId = 'e2e-hitl-multi'

    // Phase 1: 两个工具需要审批
    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          {
            type: 'hitl:required',
            content: 'file_write',
            data: {
              index: 0,
              toolName: 'file_write',
              arguments: '{"path":"/etc/config"}',
              approvalItem: {},
              action: 'required'
            }
          },
          {
            type: 'hitl:required',
            content: 'shell_exec',
            data: {
              index: 1,
              toolName: 'shell_exec',
              arguments: '{"cmd":"deploy"}',
              approvalItem: {},
              action: 'required'
            }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [
            { index: 0, toolName: 'file_write', arguments: '{"path":"/etc/config"}' },
            { index: 1, toolName: 'shell_exec', arguments: '{"cmd":"deploy"}' }
          ]
        }
      )
    )

    // Phase 2: resume 后正常完成
    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'run:done', content: '' }
        ],
        { output: 'deployed', duration: 300 }
      )
    )

    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    // 启动执行
    const builder = agentExecutor.piMono().name('multi-tool-agent').sessionId(sessionId)
    agentExecutor.submit({ sessionId, message: 'deploy', builder })
    await flushAsync()

    // 验证两个 hitl 消息
    const hitlMessages = collectedMessages.filter((m) => m.type === 'hitl')
    expect(hitlMessages).toHaveLength(2)

    // 提交第一个决策
    const r1 = await callDecide(sessionId, 0, 'approve-once')
    expect(r1.ok).toBe(true)

    // 还没有全部审批，应该仍在等待
    await flushAsync()
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(true)
    expect(mockRuntime.resumeStream).not.toHaveBeenCalled()

    // 提交第二个决策
    const r2 = await callDecide(sessionId, 1, 'approve-always')
    expect(r2.ok).toBe(true)

    await flushAsync()

    // 全部审批后自动恢复
    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(1, { alwaysApprove: true })
    expect(mockRuntime.resumeStream).toHaveBeenCalledTimes(1)

    // 最终事件序列应包含 resumed 和 done
    const finalTypes = collectedMessages.map((m) => m.type)
    expect(finalTypes).toContain('resumed')
    expect(finalTypes).toContain('done')
  })

  // ================================================================
  // 场景 4: 混合决策 — 一个 approve 一个 reject
  // ================================================================

  it('混合决策：一个工具 approve，一个 reject', async () => {
    const sessionId = 'e2e-hitl-mixed'

    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          {
            type: 'hitl:required',
            content: 'tool_a',
            data: { index: 0, toolName: 'tool_a', approvalItem: {}, action: 'required' }
          },
          {
            type: 'hitl:required',
            content: 'tool_b',
            data: { index: 1, toolName: 'tool_b', approvalItem: {}, action: 'required' }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [
            { index: 0, toolName: 'tool_a', arguments: '{}' },
            { index: 1, toolName: 'tool_b', arguments: '{}' }
          ]
        }
      )
    )

    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen([{ type: 'run:done', content: '' }], { output: 'partial', duration: 100 })
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('mixed').sessionId(sessionId)
    agentExecutor.submit({ sessionId, message: 'mixed', builder })
    await flushAsync()

    // tool_a approve, tool_b reject
    await callDecide(sessionId, 0, 'approve-once')
    await callDecide(sessionId, 1, 'reject')
    await flushAsync()

    expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
    expect(mockRuntime.rejectToolCall).toHaveBeenCalledWith(1)
    expect(mockRuntime.resumeStream).toHaveBeenCalled()
  })

  // ================================================================
  // 场景 5: 超时 — Agent 等待审批超时
  // ================================================================

  it('超时：审批未完成时超时触发 error 事件', async () => {
    const sessionId = 'e2e-hitl-timeout'

    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          {
            type: 'hitl:required',
            content: 'dangerous_tool',
            data: { index: 0, toolName: 'dangerous_tool', approvalItem: {}, action: 'required' }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [{ index: 0, toolName: 'dangerous_tool', arguments: '{}' }]
        }
      )
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('timeout-agent').sessionId(sessionId)
    agentExecutor.submit({ sessionId, message: 'will timeout', builder })
    await flushAsync()

    // 验证正在等待
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(true)

    // 推进到超时（默认 120s）
    await vi.advanceTimersByTimeAsync(120_000 + 100)

    // 验证超时 error 被广播
    const errorMsg = collectedMessages.find(
      (m) => m.type === 'error' && m.content === 'HITL approval timeout'
    )
    expect(errorMsg).toBeDefined()

    // 验证 pending 已清理
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(false)

    // 验证 runtime 被销毁（finally 块）
    expect(mockRuntime.destroy).toHaveBeenCalled()
  })

  // ================================================================
  // 场景 6: onChunk 回调 — 通过回调收到完整事件流
  // ================================================================

  it('onChunk 回调收到包含 HITL 事件的完整 chunk 序列', async () => {
    const sessionId = 'e2e-hitl-callback'
    const chunkLog: StreamChunk[] = []

    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          { type: 'text:delta', content: '准备中...' },
          {
            type: 'hitl:required',
            content: 'exec',
            data: { index: 0, toolName: 'exec', approvalItem: {}, action: 'required' }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [{ index: 0, toolName: 'exec', arguments: '{}' }]
        }
      )
    )

    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'text:delta', content: '完成' },
          { type: 'run:done', content: '' }
        ],
        { output: '完成', duration: 200 }
      )
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('callback-agent').sessionId(sessionId)
    agentExecutor.submit({
      sessionId,
      message: 'test callback',
      builder,
      onChunk: (chunk) => chunkLog.push({ ...chunk })
    })
    await flushAsync()

    // Phase 1 chunks
    const phase1Types = chunkLog.map((c) => c.type)
    expect(phase1Types).toContain('run:start')
    expect(phase1Types).toContain('text:delta')
    expect(phase1Types).toContain('hitl:required')

    // 提交审批
    hitlApprovalManager.submitDecision(sessionId, 0, 'approve-once')
    await flushAsync()

    // Phase 2 chunks（resume 后）
    const allTypes = chunkLog.map((c) => c.type)
    expect(allTypes).toContain('run:resumed')
    expect(allTypes).toContain('run:done')

    // 验证 chunk 序列的顺序
    const startIdx = allTypes.indexOf('run:start')
    const hitlIdx = allTypes.indexOf('hitl:required')
    const resumedIdx = allTypes.indexOf('run:resumed')
    const doneIdx = allTypes.indexOf('run:done')

    expect(startIdx).toBeLessThan(hitlIdx)
    expect(hitlIdx).toBeLessThan(resumedIdx)
    expect(resumedIdx).toBeLessThan(doneIdx)
  })

  // ================================================================
  // 场景 7: 多轮中断 — resume 后再次 interrupted
  // ================================================================

  it('多轮中断：第一次 approve 后又遇到新的 HITL，需要再次审批', async () => {
    const sessionId = 'e2e-hitl-multi-round'

    // Phase 1: 第一次中断
    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          {
            type: 'hitl:required',
            content: 'tool_round1',
            data: { index: 0, toolName: 'tool_round1', approvalItem: {}, action: 'required' }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [{ index: 0, toolName: 'tool_round1', arguments: '{}' }]
        }
      )
    )

    // Phase 2: 第一次 resume 后又中断
    const resumeInterruptedResult: ExecutionResult = {
      output: '',
      interrupted: true,
      interruptions: [{ index: 0, toolName: 'tool_round2', arguments: '{}' }]
    }
    // Phase 3: 第二次 resume 后正常完成
    const finalResult: ExecutionResult = { output: 'finally done', duration: 1000 }

    let resumeCallCount = 0
    mockRuntime.resumeStream.mockImplementation(() => {
      resumeCallCount++
      if (resumeCallCount === 1) {
        // 第一次 resume → 又遇到 HITL
        return createStreamGen(
          [
            { type: 'run:resumed', content: '' },
            { type: 'text:delta', content: '继续执行中...' },
            {
              type: 'hitl:required',
              content: 'tool_round2',
              data: { index: 0, toolName: 'tool_round2', approvalItem: {}, action: 'required' }
            }
          ],
          resumeInterruptedResult
        )
      }
      // 第二次 resume → 正常完成
      return createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'text:delta', content: 'finally done' },
          { type: 'run:done', content: '' }
        ],
        finalResult
      )
    })

    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('multi-round').sessionId(sessionId)
    agentExecutor.submit({ sessionId, message: 'multi round', builder })
    await flushAsync()

    // 第一轮：审批 tool_round1
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(true)
    hitlApprovalManager.submitDecision(sessionId, 0, 'approve-once')
    await flushAsync()

    // 第二轮：又进入 HITL 等待（tool_round2）
    expect(hitlApprovalManager.hasPending(sessionId)).toBe(true)
    hitlApprovalManager.submitDecision(sessionId, 0, 'approve-always')
    await flushAsync()

    // 验证 resumeStream 被调用了两次
    expect(mockRuntime.resumeStream).toHaveBeenCalledTimes(2)

    // 验证事件序列中有两次 interrupted 和两次 resumed
    const msgTypes = collectedMessages.map((m) => m.type)
    const interruptedCount = msgTypes.filter((t) => t === 'interrupted').length
    const resumedCount = msgTypes.filter((t) => t === 'resumed').length
    expect(interruptedCount).toBe(2)
    expect(resumedCount).toBe(2)

    // 最终有 done
    expect(msgTypes).toContain('done')

    // 验证 runtime 仅被销毁一次（在最终完成后）
    expect(mockRuntime.destroy).toHaveBeenCalledTimes(1)
  })

  // ================================================================
  // 场景 8: 事件序列完整性验证
  // ================================================================

  it('事件序列验证：start → text → hitl → interrupted → resumed → text → done', async () => {
    const sessionId = 'e2e-hitl-sequence'

    mockRuntime.stream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:start', content: '' },
          { type: 'text:delta', content: '分析中...' },
          {
            type: 'hitl:required',
            content: 'risky_tool',
            data: { index: 0, toolName: 'risky_tool', approvalItem: {}, action: 'required' }
          }
        ],
        {
          output: '',
          interrupted: true,
          interruptions: [{ index: 0, toolName: 'risky_tool', arguments: '{}' }]
        }
      )
    )

    mockRuntime.resumeStream.mockReturnValue(
      createStreamGen(
        [
          { type: 'run:resumed', content: '' },
          { type: 'text:delta', content: '执行完毕' },
          { type: 'run:done', content: '' }
        ],
        { output: '执行完毕', duration: 100 }
      )
    )
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)

    const builder = agentExecutor.piMono().name('seq').sessionId(sessionId)
    agentExecutor.submit({ sessionId, message: 'sequence test', builder })
    await flushAsync()

    hitlApprovalManager.submitDecision(sessionId, 0, 'approve-once')
    await flushAsync()

    // 验证完整事件序列
    const msgTypes = collectedMessages.map((m) => m.type)

    // 期望的顺序
    const expectedSequence: StreamMessage['type'][] = [
      'start',
      'text',
      'hitl',
      'interrupted',
      'resumed',
      'text',
      'done'
    ]

    // 逐个验证顺序
    let lastIdx = -1
    for (const expectedType of expectedSequence) {
      const idx = msgTypes.indexOf(expectedType, lastIdx + 1)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }

    // 验证每条消息都有正确的 sessionId
    for (const msg of collectedMessages) {
      expect(msg.sessionId).toBe(sessionId)
    }

    // 验证每条消息的 sequence 单调递增
    for (let i = 1; i < collectedMessages.length; i++) {
      expect(collectedMessages[i].sequence).toBeGreaterThan(collectedMessages[i - 1].sequence)
    }

    // 验证来源信息
    for (const msg of collectedMessages) {
      expect(msg.source.name).toBe('HitlTestAgent')
      expect(msg.source.type).toBe('agent')
    }
  })
})
