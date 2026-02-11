/**
 * TeamRuntime 测试
 *
 * 测试参数驱动的 TeamRuntime：
 * - 初始化（成员 Agent 创建）
 * - 顺序执行
 * - 并行执行
 * - 流式执行（8 层闭环事件）
 * - HITL 接口（预留，抛出 not supported）
 * - 会话管理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockRun, mockStreamEmitter } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockStreamEmitter: {
    emitStart: vi.fn().mockResolvedValue(undefined),
    emitDone: vi.fn().mockResolvedValue(undefined),
    emitError: vi.fn().mockResolvedValue(undefined),
    emitText: vi.fn().mockResolvedValue(undefined),
    emitThinking: vi.fn().mockResolvedValue(undefined),
    emitToolCall: vi.fn().mockResolvedValue(undefined),
    emitToolResult: vi.fn().mockResolvedValue(undefined),
    emitHandoff: vi.fn().mockResolvedValue(undefined),
    emitToolApproval: vi.fn().mockResolvedValue(undefined),
    emitAgentUpdated: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined)
  }
}))

// ===== Mock @openai/agents =====
vi.mock('@openai/agents', () => ({
  Agent: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    return { name: config.name || 'Agent', ...config }
  }),
  run: (...args: unknown[]) => mockRun(...args)
}))

// ===== Mock StreamEmitter =====
vi.mock('../../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn().mockReturnValue(mockStreamEmitter)
}))

import { TeamRuntime, type TeamRuntimeOptions } from './TeamRuntime'

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

  // ===== 流式执行 =====

  describe('runStream', () => {
    beforeEach(async () => {
      await team.initialize()
    })

    it('发送完整闭环事件：run:start → turn/llm/text 闭环 → run:done', async () => {
      mockRun
        .mockResolvedValueOnce({ finalOutput: 'output1' })
        .mockResolvedValueOnce({ finalOutput: 'output2' })

      const chunks: Array<{ type: string; content?: string }> = []
      await team.runStream('test', {}, (chunk) => chunks.push(chunk))

      // run 闭环
      expect(chunks[0].type).toBe('run:start')
      expect(chunks[chunks.length - 1].type).toBe('run:done')

      // turn 闭环
      const turnStart = chunks.filter((c) => c.type === 'turn:start')
      expect(turnStart).toHaveLength(1)
      const turnDone = chunks.filter((c) => c.type === 'turn:done')
      expect(turnDone).toHaveLength(1)

      // llm 闭环
      const llmStart = chunks.filter((c) => c.type === 'llm:start')
      expect(llmStart).toHaveLength(1)
      const llmDone = chunks.filter((c) => c.type === 'llm:done')
      expect(llmDone).toHaveLength(1)

      // text 闭环
      const textStart = chunks.filter((c) => c.type === 'text:start')
      expect(textStart).toHaveLength(1)
      const textDelta = chunks.filter((c) => c.type === 'text:delta')
      expect(textDelta).toHaveLength(1)
      const textDone = chunks.filter((c) => c.type === 'text:done')
      expect(textDone).toHaveLength(1)

      expect(mockStreamEmitter.emitStart).toHaveBeenCalled()
      expect(mockStreamEmitter.emitDone).toHaveBeenCalled()
    })
  })

  // ===== HITL =====

  describe('HITL', () => {
    it('approveToolCall 抛出不支持错误', () => {
      expect(() => team.approveToolCall(0)).toThrow('does not yet support')
    })

    it('rejectToolCall 抛出不支持错误', () => {
      expect(() => team.rejectToolCall(0)).toThrow('does not yet support')
    })

    it('resumeStream 抛出不支持错误', async () => {
      const gen = team.resumeStream()
      await expect(gen.next()).rejects.toThrow('does not yet support')
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
