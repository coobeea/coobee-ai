/**
 * TeamRuntime 测试
 *
 * 测试 AbstractAgentRuntime 基类继承后的 TeamRuntime：
 * - 初始化（成员 Agent 创建）
 * - 属性（supportsHITL、type、name 等）
 * - 顺序执行（run + stream 增量流式）
 * - 并行执行
 * - 流式执行（闭环事件）
 * - HITL 接口（继承自基类，抛出 not support）
 * - 会话管理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockRun } = vi.hoisted(() => ({
  mockRun: vi.fn()
}))

// ===== Mock @openai/agents =====
vi.mock('@openai/agents', () => ({
  Agent: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    return { name: config.name || 'Agent', ...config }
  }),
  run: (...args: unknown[]) => mockRun(...args)
}))

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

import { TeamRuntime, type TeamRuntimeOptions } from '../TeamRuntime'

function createTeamOptions(overrides?: Partial<TeamRuntimeOptions>): TeamRuntimeOptions {
  return {
    name: 'TestTeam',
    orchestrationType: 'sequential',
    members: [
      {
        name: 'Writer',
        instructions: 'You are a writer.',
        role: 'writer',
        priority: 2
      },
      {
        name: 'Editor',
        instructions: 'You are an editor.',
        role: 'editor',
        priority: 1
      }
    ],
    sessionId: 'session-team-1',
    ...overrides
  }
}

describe('TeamRuntime', () => {
  let team: TeamRuntime

  beforeEach(() => {
    vi.clearAllMocks()
    team = new TeamRuntime(createTeamOptions())
  })

  // ===== 初始化 =====

  describe('initialize', () => {
    it('为每个成员创建 Agent', async () => {
      const { Agent } = await import('@openai/agents')
      await team.initialize()

      expect(Agent).toHaveBeenCalledTimes(2)
      expect(Agent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Writer' }))
      expect(Agent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Editor' }))
    })
  })

  // ===== 属性 =====

  describe('属性', () => {
    it('type 为 team', () => {
      expect(team.type).toBe('team')
    })

    it('name 返回配置名称', () => {
      expect(team.name).toBe('TestTeam')
    })

    it('interrupted 初始为 false', () => {
      expect(team.interrupted).toBe(false)
    })

    it('supportsHITL 返回 false', () => {
      expect(team.supportsHITL).toBe(false)
    })

    it('id 以 team- 为前缀', () => {
      expect(team.id).toMatch(/^team-/)
    })
  })

  // ===== 顺序执行 =====

  describe('run (sequential)', () => {
    beforeEach(async () => {
      await team.initialize()
    })

    it('按优先级顺序执行成员', async () => {
      mockRun
        .mockResolvedValueOnce({ finalOutput: 'writer output' })
        .mockResolvedValueOnce({ finalOutput: 'editor output' })

      const result = await team.run('Write something')

      // Writer (priority 2) 先执行，Editor (priority 1) 后执行
      expect(mockRun).toHaveBeenCalledTimes(2)
      expect(result.output).toBe('editor output')
    })

    it('前一个 Agent 的输出作为下一个的输入', async () => {
      mockRun
        .mockResolvedValueOnce({ finalOutput: 'draft content' })
        .mockResolvedValueOnce({ finalOutput: 'edited content' })

      await team.run('Write an article')

      // 第二次调用的输入应该是第一次的输出
      expect(mockRun.mock.calls[1][1]).toBe('draft content')
    })
  })

  // ===== 并行执行 =====

  describe('run (parallel)', () => {
    beforeEach(async () => {
      team = new TeamRuntime(createTeamOptions({ orchestrationType: 'parallel' }))
      await team.initialize()
    })

    it('所有成员并行执行', async () => {
      mockRun.mockResolvedValue({ finalOutput: 'result' })

      const result = await team.run('Analyze this')

      expect(mockRun).toHaveBeenCalledTimes(2)
      const parsed = JSON.parse(result.output)
      expect(parsed.results).toHaveLength(2)
    })
  })

  // ===== Sequential 流式执行（增量模式） =====

  describe('stream (sequential — 增量流式)', () => {
    beforeEach(async () => {
      await team.initialize()
    })

    it('每个成员产生独立的 turn，实现增量输出', async () => {
      mockRun
        .mockResolvedValueOnce({ finalOutput: 'writer output' })
        .mockResolvedValueOnce({ finalOutput: 'editor output' })

      const chunks: Array<{ type: string; content?: string }> = []
      await team.runStream('test', {}, (chunk) => chunks.push(chunk))

      // run 闭环
      expect(chunks[0].type).toBe('run:start')
      expect(chunks[chunks.length - 1].type).toBe('run:done')

      // sequential 模式：每个成员一个 turn → 2 个成员 = 2 个 turn
      const turnStarts = chunks.filter((c) => c.type === 'turn:start')
      const turnDones = chunks.filter((c) => c.type === 'turn:done')
      expect(turnStarts).toHaveLength(2)
      expect(turnDones).toHaveLength(2)

      // 每个 turn 都有 llm/text 闭环
      const llmStarts = chunks.filter((c) => c.type === 'llm:start')
      const textDeltas = chunks.filter((c) => c.type === 'text:delta')
      expect(llmStarts).toHaveLength(2)
      expect(textDeltas).toHaveLength(2)

      // handoff 事件：每个成员切换时产生
      const handoffs = chunks.filter((c) => c.type === 'handoff:start')
      expect(handoffs).toHaveLength(2)
    })

    it('最终输出是最后一个成员的输出', async () => {
      mockRun
        .mockResolvedValueOnce({ finalOutput: 'draft' })
        .mockResolvedValueOnce({ finalOutput: 'final edited' })

      const gen = team.stream('test')
      let r = await gen.next()
      while (!r.done) {
        r = await gen.next()
      }

      expect(r.value.output).toBe('final edited')
    })
  })

  // ===== Parallel 流式执行（阻塞模式） =====

  describe('stream (parallel — 阻塞后输出)', () => {
    beforeEach(async () => {
      team = new TeamRuntime(createTeamOptions({ orchestrationType: 'parallel' }))
      await team.initialize()
    })

    it('run:start → 单 turn → run:done', async () => {
      mockRun.mockResolvedValue({ finalOutput: 'result' })

      const chunks: Array<{ type: string }> = []
      await team.runStream('test', {}, (chunk) => chunks.push(chunk))

      expect(chunks[0].type).toBe('run:start')
      expect(chunks[chunks.length - 1].type).toBe('run:done')

      // parallel 只有 1 个 turn（汇总输出）
      const turnStarts = chunks.filter((c) => c.type === 'turn:start')
      expect(turnStarts).toHaveLength(1)
    })
  })

  // ===== HITL（继承自 AbstractAgentRuntime） =====

  describe('HITL', () => {
    it('approveToolCall 抛出不支持错误', () => {
      expect(() => team.approveToolCall(0)).toThrow('does not support')
    })

    it('rejectToolCall 抛出不支持错误', () => {
      expect(() => team.rejectToolCall(0)).toThrow('does not support')
    })

    it('resumeStream 抛出不支持错误', async () => {
      const gen = team.resumeStream()
      await expect(gen.next()).rejects.toThrow('does not support')
    })
  })

  // ===== 会话管理 =====

  describe('会话管理', () => {
    it('getSession 返回基本信息', async () => {
      await team.initialize()
      const session = await team.getSession()

      expect(session.sessionId).toBe('session-team-1')
      expect(session.metadata?.teamName).toBe('TestTeam')
      expect(session.metadata?.memberCount).toBe(2)
    })
  })

  // ===== 销毁 =====

  describe('destroy', () => {
    it('清理成员', async () => {
      await team.initialize()
      await team.destroy()
      // 销毁后不应报错
    })
  })
})
