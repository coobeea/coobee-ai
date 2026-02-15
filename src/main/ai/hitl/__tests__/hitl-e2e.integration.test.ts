/**
 * HITL E2E 集成测试
 *
 * HITL 审批已从 AgentExecutor 移至 tool-approval Extension（before_tool_call Hook）。
 *
 * 此文件测试：
 *   1. Gateway hitl.decide API 的参数校验
 *   2. HitlApprovalManager per-call API 与 Gateway 的集成
 *   3. 基本的 Agent 执行流程（无 HITL 中断）
 *
 * 完整的 HITL 审批流程测试应在 tool-approval Extension 的测试中覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExecutionResult, StreamChunk } from '../../runtime/types'

// ===== 仅 mock runtime 和 env =====

const mockRuntime = vi.hoisted(() => ({
  type: 'agent' as const,
  id: 'agent-hitl-e2e',
  name: 'HitlTestAgent',
  options: { name: 'HitlTestAgent', instructions: 'test' },
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
}))

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

vi.mock('../../runtime/pimono', () => ({
  PiMonoAgentRuntime: class MockPiMonoRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

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

vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getHookRunner: () => null,
    getRegistry: () => null
  }
}))

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
  SkillManager: Object.assign(
    class MockSkillManager {
      scanSkills = (): [] => []
      get size(): number {
        return 0
      }
    },
    { setCurrent: vi.fn(), getCurrent: vi.fn() }
  )
}))

// ===== 导入真实模块 =====
import { hitlApprovalManager } from '../HitlApprovalManager'
import { approvalMethods } from '@main/gateway/methods/approval'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

/**
 * 辅助函数：模拟通过 Gateway 调用 hitl.decide
 */
async function callDecide(
  sessionId: string,
  index: number,
  decision: HitlApprovalDecision | string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await approvalMethods.methods.decide(
      { sessionId, index, decision } as Record<string, unknown>,
      null as never
    )
    return result as { ok: boolean; error?: string }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

describe('HITL E2E 集成测试', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    process.env.VITE_LLM_API_KEY = 'test-key'
  })

  afterEach(() => {
    hitlApprovalManager.cleanupAll()
    vi.useRealTimers()
  })

  // ================================================================
  // Gateway hitl.decide 参数校验
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
        error: 'No pending approval for this approvalId'
      })
    })
  })

  // ================================================================
  // Gateway + HitlApprovalManager per-call 集成
  // ================================================================

  describe('Gateway + HitlApprovalManager per-call 集成', () => {
    it('Gateway 提交决策 → HitlApprovalManager resolve', async () => {
      // 模拟 tool-approval Extension 创建的等待
      const approvalId = 'session-test:0'
      const promise = hitlApprovalManager.waitForSingleDecision(approvalId)

      // 通过 Gateway API 提交决策
      const result = await callDecide('session-test', 0, 'approve-once')
      expect(result).toEqual({ ok: true })

      // 等待 resolve
      const decision = await promise
      expect(decision).toBe('approve-once')
    })

    it('Gateway reject → HitlApprovalManager resolve reject', async () => {
      const approvalId = 'session-reject:0'
      const promise = hitlApprovalManager.waitForSingleDecision(approvalId)

      const result = await callDecide('session-reject', 0, 'reject')
      expect(result).toEqual({ ok: true })

      const decision = await promise
      expect(decision).toBe('reject')
    })

    it('多个工具独立审批', async () => {
      const p0 = hitlApprovalManager.waitForSingleDecision('session-multi:0')
      const p1 = hitlApprovalManager.waitForSingleDecision('session-multi:1')

      await callDecide('session-multi', 1, 'reject')
      await callDecide('session-multi', 0, 'approve-once')

      expect(await p0).toBe('approve-once')
      expect(await p1).toBe('reject')
    })

    it('超时后 Gateway 提交失败', async () => {
      hitlApprovalManager.waitForSingleDecision('session-timeout:0', 500)
      vi.advanceTimersByTime(501)

      const result = await callDecide('session-timeout', 0, 'approve-once')
      expect(result.ok).toBe(false)
    })
  })

  // ================================================================
  // 基本 Agent 执行（无 HITL）
  // ================================================================

  describe('基本 Agent 执行', () => {
    it('正常执行不涉及 HITL', async () => {
      const agentExecutor = (await import('../../AgentExecutor')).agentExecutor

      function createStreamGen(
        chunks: StreamChunk[],
        result: ExecutionResult
      ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
        async function* gen(): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
          for (const c of chunks) yield c
          return result
        }
        return gen()
      }

      mockRuntime.stream.mockReturnValue(
        createStreamGen(
          [
            { type: 'run:start', content: '' },
            { type: 'text:delta', content: '你好' },
            { type: 'run:done', content: '' }
          ],
          { output: '你好', duration: 100 }
        )
      )
      mockRuntime.initialize.mockResolvedValue(undefined)
      mockRuntime.destroy.mockResolvedValue(undefined)

      // 预热
      await import('../../runtime/pimono')
      await import('../../AgentEnv')
      await import('../../skills')

      const builder = agentExecutor.piMono().name('basic').sessionId('session-basic')
      const result = await agentExecutor.submitAndWait({
        sessionId: 'session-basic',
        message: '你好',
        builder
      })

      expect(result.output).toBe('你好')
      expect(mockRuntime.destroy).toHaveBeenCalled()
    })
  })
})
