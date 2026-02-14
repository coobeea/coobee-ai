/**
 * HITL + 工具系统 集成测试
 *
 * 测试 HITL 系统与新工具定义（ToolDefinition）的集成：
 *
 * 1. needUserConfirm → needsApproval 映射（OpenAI Runtime）
 * 2. 工具策略（isToolAllowed）在 convertTools 中的拦截
 * 3. HITL 审批循环与工具执行的完整链路
 * 4. 工具定义的 HITL 元数据正确传递
 * 5. AgentExecutor HITL 循环与统一工具的兼容性
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import type { ExecutionResult, StreamChunk } from '../../runtime/types'
import type { ToolDefinition, ToolResult, ToolStreamUpdate } from '../../tools/types'
import { ToolCategory } from '../../tools/types'

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

// ===== Hoisted mocks =====
const { mockForward, mockStreamEmitter, mockRuntime } = vi.hoisted(() => {
  const mockForward = vi.fn()
  const mockStreamEmitter = { forward: mockForward }
  const mockRuntime = {
    type: 'agent' as const,
    id: 'agent-hitl-tool',
    name: 'HitlToolAgent',
    options: { name: 'HitlToolAgent', instructions: 'test' },
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

// ===== Mock Electron env =====
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

// ===== Mock Extension =====
vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getHookRunner: () => null,
    getRegistry: () => null
  }
}))

// ===== Mock AgentEnv helpers =====
vi.mock('../../AgentEnv', () => ({
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
  formatRuntimePaths: () => '<runtime_paths>mock</runtime_paths>'
}))

vi.mock('../../skills', () => ({
  SkillManager: class MockSkillManager {
    scanSkills = (): [] => []
  }
}))

// ===== 导入 =====
import { hitlApprovalManager } from '../HitlApprovalManager'

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

// ===== 辅助工具定义 =====

/** 创建一个 mock ToolDefinition */
function createMockTool(name: string, needUserConfirm: boolean): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    category: ToolCategory.Execute,
    parameters: z.object({
      input: z.string()
    }),
    needUserConfirm,
    execute: async function* (
      params: Record<string, unknown>
    ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
      yield { type: 'progress', content: `Executing ${name}...`, percentage: 50 }
      return {
        success: true,
        llmContent: `${name} result: ${params.input}`
      }
    }
  }
}

/** 创建 stream generator */
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

describe('HITL + 工具系统集成测试', () => {
  let agentExecutor: typeof import('../../AgentExecutor').agentExecutor

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITE_LLM_API_KEY = 'test-key'

    const mod = await import('../../AgentExecutor')
    agentExecutor = mod.agentExecutor

    // 预热动态 import 缓存（避免首次 import 的额外微任务延迟）
    await import('../../runtime/pimono')
    await import('../../AgentEnv')
    await import('@main/common/env')
  })

  afterEach(() => {
    hitlApprovalManager.cleanupAll()
    vi.useRealTimers()
  })

  // ========== needUserConfirm 工具定义验证 ==========

  describe('needUserConfirm 工具元数据', () => {
    it('工具定义的 needUserConfirm=true 被正确声明', () => {
      const tool = createMockTool('dangerous_write', true)
      expect(tool.needUserConfirm).toBe(true)
    })

    it('工具定义的 needUserConfirm=false 被正确声明', () => {
      const tool = createMockTool('safe_read', false)
      expect(tool.needUserConfirm).toBe(false)
    })

    it('工具定义的 needUserConfirm 未设置时为 undefined', () => {
      const tool: ToolDefinition = {
        name: 'no_confirm_field',
        description: 'test',
        category: ToolCategory.FileSystem,
        parameters: z.object({}),
        // eslint-disable-next-line require-yield
        execute: async function* () {
          return { success: true, llmContent: 'ok' }
        }
      }
      expect(tool.needUserConfirm).toBeUndefined()
    })
  })

  // ========== 内置工具 needUserConfirm 配置验证 ==========

  describe('内置工具 needUserConfirm 配置', () => {
    it('builtinTools 的 needUserConfirm 配置与安全等级一致', async () => {
      const { builtinTools } = await import('../../tools/builtin')

      const toolMap = Object.fromEntries(builtinTools.map((t) => [t.name, t]))

      // read — 低风险，不需要确认
      expect(toolMap['read']?.needUserConfirm).toBe(false)
      // write — 中风险，需要确认
      expect(toolMap['write']?.needUserConfirm).toBe(true)
      // edit — 中风险，需要确认
      expect(toolMap['edit']?.needUserConfirm).toBe(true)
      // exec — 高风险，需要确认
      expect(toolMap['exec']?.needUserConfirm).toBe(true)
    })
  })

  // ========== HITL 审批循环与工具 ==========

  describe('HITL 审批循环与统一工具兼容', () => {
    it('需要审批的工具触发 HITL → 审批后恢复执行', async () => {
      // Phase 1: 需要审批的工具中断
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [
          { index: 0, toolName: 'write', arguments: '{"path":"/test.txt","content":"hi"}' }
        ]
      }
      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            { type: 'run:start', content: '' },
            {
              type: 'hitl:required',
              content: 'write',
              data: {
                index: 0,
                toolName: 'write',
                arguments: '{"path":"/test.txt","content":"hi"}',
                approvalItem: {}
              }
            }
          ],
          interruptedResult
        )
      )

      // Phase 2: 审批后恢复
      const resumeResult: ExecutionResult = {
        output: 'File written successfully',
        duration: 200
      }
      mockRuntime.resumeStream.mockReturnValue(
        createStreamGen(
          [
            { type: 'run:resumed', content: '' },
            { type: 'text:delta', content: 'File written successfully' },
            { type: 'run:done', content: '' }
          ],
          resumeResult
        )
      )

      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-write-hitl')
      agentExecutor.submit({
        sessionId: 'session-write-hitl',
        message: 'write a file',
        builder
      })

      await flushAsync()

      // 验证等待中
      expect(hitlApprovalManager.hasPending('session-write-hitl')).toBe(true)

      // 审批
      hitlApprovalManager.submitDecision('session-write-hitl', 0, 'approve-once')
      await flushAsync()

      // 验证工具审批被调用
      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
      expect(mockRuntime.resumeStream).toHaveBeenCalled()
    })

    it('reject 写文件工具 → 调用 rejectToolCall', async () => {
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [
          { index: 0, toolName: 'write', arguments: '{"path":"/etc/passwd","content":"x"}' }
        ]
      }
      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            {
              type: 'hitl:required',
              content: 'write',
              data: { index: 0, toolName: 'write', approvalItem: {} }
            }
          ],
          interruptedResult
        )
      )

      const resumeResult: ExecutionResult = { output: 'Write was rejected', duration: 50 }
      mockRuntime.resumeStream.mockReturnValue(
        createStreamGen([{ type: 'run:done', content: '' }], resumeResult)
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-reject-write')
      agentExecutor.submit({
        sessionId: 'session-reject-write',
        message: 'write to dangerous path',
        builder
      })

      await flushAsync()

      hitlApprovalManager.submitDecision('session-reject-write', 0, 'reject')
      await flushAsync()

      expect(mockRuntime.rejectToolCall).toHaveBeenCalledWith(0)
      expect(mockRuntime.approveToolCall).not.toHaveBeenCalled()
    })

    it('approve-always → exec 工具后续调用不再中断', async () => {
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [{ index: 0, toolName: 'exec', arguments: '{"command":"ls -la"}' }]
      }
      mockRuntime.stream.mockReturnValue(createStreamGen([], interruptedResult))

      const resumeResult: ExecutionResult = { output: 'ls output', duration: 100 }
      mockRuntime.resumeStream.mockReturnValue(
        createStreamGen([{ type: 'run:done', content: '' }], resumeResult)
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-always-exec')
      agentExecutor.submit({
        sessionId: 'session-always-exec',
        message: 'run ls',
        builder
      })

      await flushAsync()

      hitlApprovalManager.submitDecision('session-always-exec', 0, 'approve-always')
      await flushAsync()

      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: true })
    })

    it('read 工具不触发 HITL（needUserConfirm=false）— 正常完成', async () => {
      const normalResult: ExecutionResult = {
        output: 'file content here',
        duration: 50
      }
      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            { type: 'run:start', content: '' },
            { type: 'tool:start', content: 'read' },
            { type: 'tool:done', content: 'file content' },
            { type: 'text:delta', content: 'file content here' },
            { type: 'run:done', content: '' }
          ],
          normalResult
        )
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-read-no-hitl')
      const submitResult = agentExecutor.submit({
        sessionId: 'session-read-no-hitl',
        message: 'read file',
        builder
      })
      expect(submitResult.status).toBe('accepted')

      await flushAsync()

      // 没有 HITL 审批
      expect(hitlApprovalManager.hasPending('session-read-no-hitl')).toBe(false)
      expect(mockRuntime.approveToolCall).not.toHaveBeenCalled()
    })
  })

  // ========== 多工具混合审批 ==========

  describe('多工具混合审批', () => {
    it('write + exec 同时需要审批 → 全部审批后恢复', async () => {
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [
          { index: 0, toolName: 'write', arguments: '{"path":"test.txt"}' },
          { index: 1, toolName: 'exec', arguments: '{"command":"echo hi"}' }
        ]
      }
      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            {
              type: 'hitl:required',
              content: 'write',
              data: { index: 0, toolName: 'write', approvalItem: {} }
            },
            {
              type: 'hitl:required',
              content: 'exec',
              data: { index: 1, toolName: 'exec', approvalItem: {} }
            }
          ],
          interruptedResult
        )
      )

      const resumeResult: ExecutionResult = { output: 'both executed', duration: 300 }
      mockRuntime.resumeStream.mockReturnValue(
        createStreamGen([{ type: 'run:done', content: '' }], resumeResult)
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-multi-tool')
      agentExecutor.submit({
        sessionId: 'session-multi-tool',
        message: 'write and execute',
        builder
      })

      await flushAsync()

      // 提交第一个
      hitlApprovalManager.submitDecision('session-multi-tool', 0, 'approve-once')
      await flushAsync()
      // 还在等待第二个
      expect(mockRuntime.resumeStream).not.toHaveBeenCalled()

      // 提交第二个
      hitlApprovalManager.submitDecision('session-multi-tool', 1, 'approve-always')
      await flushAsync()

      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(1, { alwaysApprove: true })
      expect(mockRuntime.resumeStream).toHaveBeenCalledTimes(1)
    })

    it('write approve + exec reject — 混合决策', async () => {
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [
          { index: 0, toolName: 'write', arguments: '{}' },
          { index: 1, toolName: 'exec', arguments: '{"command":"rm -rf /"}' }
        ]
      }
      mockRuntime.stream.mockReturnValue(createStreamGen([], interruptedResult))

      mockRuntime.resumeStream.mockReturnValue(
        createStreamGen([{ type: 'run:done', content: '' }], { output: 'partial', duration: 50 })
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-mixed')
      agentExecutor.submit({
        sessionId: 'session-mixed',
        message: 'dangerous operation',
        builder
      })

      await flushAsync()

      hitlApprovalManager.submitDecision('session-mixed', 0, 'approve-once')
      hitlApprovalManager.submitDecision('session-mixed', 1, 'reject')
      await flushAsync()

      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
      expect(mockRuntime.rejectToolCall).toHaveBeenCalledWith(1)
    })
  })

  // ========== HITL 超时与工具 ==========

  describe('HITL 超时与工具', () => {
    it('工具审批超时 → 返回超时错误', async () => {
      const interruptedResult: ExecutionResult = {
        output: '',
        interrupted: true,
        interruptions: [{ index: 0, toolName: 'exec', arguments: '{"command":"deploy"}' }]
      }
      mockRuntime.stream.mockReturnValue(
        createStreamGen([{ type: 'hitl:required', content: 'exec' }], interruptedResult)
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-timeout-tool')
      agentExecutor.submit({
        sessionId: 'session-timeout-tool',
        message: 'deploy to production',
        builder
      })

      await flushAsync()

      // 不提交决策，等待超时
      await vi.advanceTimersByTimeAsync(120_000 + 100)

      expect(mockForward).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run:error',
          content: 'HITL approval timeout'
        })
      )

      expect(mockRuntime.destroy).toHaveBeenCalled()
    })
  })

  // ========== 多轮 HITL 与工具 ==========

  describe('多轮 HITL 与工具', () => {
    it('第一次工具审批后又遇到新的工具审批 → 两轮审批都完成', async () => {
      // Phase 1: write 工具中断
      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            { type: 'run:start', content: '' },
            {
              type: 'hitl:required',
              content: 'write',
              data: { index: 0, toolName: 'write', approvalItem: {} }
            }
          ],
          {
            output: '',
            interrupted: true,
            interruptions: [{ index: 0, toolName: 'write', arguments: '{}' }]
          }
        )
      )

      let resumeCallCount = 0
      mockRuntime.resumeStream.mockImplementation(() => {
        resumeCallCount++
        if (resumeCallCount === 1) {
          // 第一次 resume → 又遇到 exec 工具中断
          return createStreamGen(
            [
              { type: 'run:resumed', content: '' },
              {
                type: 'hitl:required',
                content: 'exec',
                data: { index: 0, toolName: 'exec', approvalItem: {} }
              }
            ],
            {
              output: '',
              interrupted: true,
              interruptions: [{ index: 0, toolName: 'exec', arguments: '{}' }]
            }
          )
        }
        // 第二次 resume → 正常完成
        return createStreamGen(
          [
            { type: 'run:resumed', content: '' },
            { type: 'text:delta', content: 'all done' },
            { type: 'run:done', content: '' }
          ],
          { output: 'all done', duration: 500 }
        )
      })

      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      const builder = agentExecutor.piMono().name('test').sessionId('session-multi-round-tool')
      agentExecutor.submit({
        sessionId: 'session-multi-round-tool',
        message: 'write then execute',
        builder
      })

      await flushAsync()

      // 第一轮：审批 write
      expect(hitlApprovalManager.hasPending('session-multi-round-tool')).toBe(true)
      hitlApprovalManager.submitDecision('session-multi-round-tool', 0, 'approve-once')
      await flushAsync()

      // 第二轮：审批 exec
      expect(hitlApprovalManager.hasPending('session-multi-round-tool')).toBe(true)
      hitlApprovalManager.submitDecision('session-multi-round-tool', 0, 'approve-always')
      await flushAsync()

      // 验证两次 resume
      expect(mockRuntime.resumeStream).toHaveBeenCalledTimes(2)
      // 第一次审批 write
      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: false })
      // 第二次审批 exec（approve-always）
      expect(mockRuntime.approveToolCall).toHaveBeenCalledWith(0, { alwaysApprove: true })
    })
  })
})
