/**
 * AgentExecutor 环境注入集成测试
 *
 * 测试 injectEnv 的完整流程：
 *   - 环境注入成功时：Skill 和 appendInstructions 正确注入到 Builder
 *   - 环境注入失败时：不阻断执行，Builder 保持原状
 *   - Builder skills 累加模式正确工作
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// ===== Mock env =====
const mockGetAgentWorkspaceDir = vi.fn()
const mockGetSkillSearchPaths = vi.fn()

vi.mock('@main/common/env', () => ({
  Env: {
    isDev: true,
    paths: {
      userHome: '/mock/.home',
      temp: '/tmp/mock',
      builtinSkillsDir: '/mock/builtin-skills',
      userSkillsDir: '/mock/.home/skills',
      memoryDir: '/mock/.home/memory',
      userMemoryDir: '/mock/.home/memory/user',
      agentMemoryDir: '/mock/.home/memory/agent',
      workspacesDir: '/mock/.home/workspaces',
      configDir: '/mock/.home/config'
    },
    getAgentWorkspaceDir: (...args: unknown[]) => mockGetAgentWorkspaceDir(...args),
    getSkillSearchPaths: (...args: unknown[]) => mockGetSkillSearchPaths(...args)
  }
}))

// ===== Mock AgentEnv module functions =====
const mockBuildAgentEnv = vi.fn()
const mockFormatRuntimePaths = vi.fn()

vi.mock('../AgentEnv', () => ({
  buildAgentEnv: (...args: unknown[]) => mockBuildAgentEnv(...args),
  formatRuntimePaths: (...args: unknown[]) => mockFormatRuntimePaths(...args)
}))

// ===== Mock SkillManager =====
const mockScanSkills = vi.fn()
const mockSetCurrent = vi.fn()

vi.mock('../skills', () => ({
  SkillManager: Object.assign(
    class MockSkillManager {
      scanSkills = mockScanSkills
      get size(): number {
        return mockScanSkills()?.length ?? 0
      }
    },
    {
      setCurrent: (...args: unknown[]): void => mockSetCurrent(...args),
      getCurrent: vi.fn()
    }
  )
}))

// ===== Mock StreamEmitter =====
vi.mock('../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn(() => ({ forward: vi.fn() }))
}))

// ===== Mock PiMono runtime =====
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

vi.mock('../runtime/pimono', () => ({
  PiMonoAgentRuntime: class MockPiMonoRuntime {
    constructor() {
      return mockRuntime
    }
  }
}))

import { PiMonoBuilder } from '../AgentExecutor'

describe('AgentExecutor — 环境注入', () => {
  let agentExecutor: typeof import('../AgentExecutor').agentExecutor

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.VITE_LLM_API_KEY = 'test-key'

    const mod = await import('../AgentExecutor')
    agentExecutor = mod.agentExecutor

    // 默认 mock 返回值
    mockGetAgentWorkspaceDir.mockResolvedValue('/mock/.home/workspaces/session-1')
    mockGetSkillSearchPaths.mockResolvedValue(['/mock/builtin-skills', '/mock/.home/skills'])
    mockBuildAgentEnv.mockResolvedValue({
      workspace: '/mock/.home/workspaces/session-1',
      userHome: '/mock/.home',
      temp: '/tmp/mock',
      platform: 'darwin',
      isDev: true,
      skillPaths: ['/mock/builtin-skills', '/mock/.home/skills'],
      builtinSkillsDir: '/mock/builtin-skills',
      userSkillsDir: '/mock/.home/skills',
      memoryDir: '/mock/.home/memory'
    })
    mockFormatRuntimePaths.mockReturnValue('<runtime_paths>...</runtime_paths>')
    mockScanSkills.mockReturnValue([
      {
        name: 'runtime-env',
        description: '运行时环境说明',
        content: '# Runtime Environment\n...'
      }
    ])

    // runtime mock
    mockRuntime.initialize.mockResolvedValue(undefined)
    mockRuntime.destroy.mockResolvedValue(undefined)
  })

  describe('stream() 中的环境注入', () => {
    it('成功注入 <runtime_paths> 和 Skill 发现提示', async () => {
      // mock runtime.stream() 返回的 generator
      const result = { output: 'done', duration: 50 }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function* mockStreamGen(): AsyncGenerator<any, any, unknown> {
        yield { type: 'run:start', content: '' }
        yield { type: 'text:delta', content: 'hi' }
        yield { type: 'run:done', content: '' }
        return result
      }
      mockRuntime.stream.mockReturnValue(mockStreamGen())

      const builder = agentExecutor.piMono().name('test').sessionMode('file')

      const gen = agentExecutor.stream({
        sessionId: 'session-1',
        message: 'hello',
        builder
      })

      // 消费 generator
      let r = await gen.next()
      while (!r.done) {
        r = await gen.next()
      }

      // 验证 injectEnv 调用链
      expect(mockGetAgentWorkspaceDir).toHaveBeenCalledWith('session-1')
      expect(mockBuildAgentEnv).toHaveBeenCalledWith(
        'session-1',
        '/mock/.home/workspaces/session-1'
      )
      expect(mockScanSkills).toHaveBeenCalledWith([
        '/mock/builtin-skills',
        '/mock/.home/skills',
        '/mock/.home/workspaces/session-1/skills'
      ])
      expect(mockSetCurrent).toHaveBeenCalled()
      expect(mockFormatRuntimePaths).toHaveBeenCalled()
    })

    it('环境注入失败时不阻断执行', async () => {
      // 让 getAgentWorkspaceDir 抛错
      mockGetAgentWorkspaceDir.mockRejectedValue(new Error('Workspace creation failed'))

      const result = { output: 'done', duration: 50 }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function* mockStreamGen(): AsyncGenerator<any, any, unknown> {
        yield { type: 'run:start', content: '' }
        return result
      }
      mockRuntime.stream.mockReturnValue(mockStreamGen())

      const builder = agentExecutor.piMono().name('test')

      const gen = agentExecutor.stream({
        sessionId: 'session-2',
        message: 'hello',
        builder
      })

      // 不应抛错
      const collected: unknown[] = []
      let r = await gen.next()
      while (!r.done) {
        collected.push(r.value)
        r = await gen.next()
      }

      expect(collected).toHaveLength(1) // run:start
    })

    it('SkillManager 返回空数组时仍正常执行', async () => {
      mockScanSkills.mockReturnValue([])

      const result = { output: 'done' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function* mockStreamGen(): AsyncGenerator<any, any, unknown> {
        yield { type: 'run:start', content: '' }
        return result
      }
      mockRuntime.stream.mockReturnValue(mockStreamGen())

      const builder = agentExecutor.piMono().name('test')

      const gen = agentExecutor.stream({
        sessionId: 'session-3',
        message: 'hello',
        builder
      })

      let r = await gen.next()
      while (!r.done) {
        r = await gen.next()
      }

      // 验证 formatRuntimePaths 仍然被调用（路径注入不依赖 Skill）
      expect(mockFormatRuntimePaths).toHaveBeenCalled()
    })
  })

  describe('Builder skills 累加模式', () => {
    it('多次调用 skills() 会合并而非覆盖', () => {
      const builder = new PiMonoBuilder()

      builder
        .skills([{ name: 'skill-a', description: 'A', content: 'AAA' }])
        .skills([{ name: 'skill-b', description: 'B', content: 'BBB' }])

      // 通过访问内部字段验证（白盒测试）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = builder as any
      expect(internal._skills).toHaveLength(2)
      expect(internal._skills[0].name).toBe('skill-a')
      expect(internal._skills[1].name).toBe('skill-b')
    })
  })
})
