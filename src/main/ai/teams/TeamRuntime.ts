/**
 * Team 运行时
 *
 * SDK 原生优先的薄封装，所有配置通过参数传入。
 * 支持三种协作模式：顺序执行、并行执行、Planner 调度。
 *
 * 实现统一的 AgentRuntime 接口，
 * 包括 HITL 工具审批（暂停/恢复）和完整流式事件。
 */

import { run, Agent } from '@openai/agents'
import type { Tool, ModelSettings } from '@openai/agents'
import { createStreamEmitter, type IStreamEmitter } from '../streaming/StreamEmitter'
import type { AgentRuntime } from '../runtime/AgentRuntime'
import type {
  AgentRuntimeOptions,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo
} from '../runtime/types'
import type { OrchestrationType } from './types'

// ========== Team 配置类型 ==========

export type { OrchestrationType }

/** Team 成员配置 */
export interface TeamMemberConfig {
  /** Agent 名称 */
  name: string
  /** Agent 系统指令 */
  instructions: string
  /** 成员角色描述 */
  role: string
  /** 模型名称 */
  model?: string
  /** 模型参数 */
  modelSettings?: ModelSettings
  /** 工具列表 */
  tools?: Tool[]
  /** 优先级（顺序执行时生效） */
  priority?: number
}

/** TeamRuntime 创建选项 */
export interface TeamRuntimeOptions {
  /** Team 名称 */
  name: string
  /** 协作模式 */
  orchestrationType: OrchestrationType
  /** 成员配置列表 */
  members: TeamMemberConfig[]
  /** 会话 ID */
  sessionId?: string
  /** 最大轮次 */
  maxTurns?: number
}

// ========== TeamRuntime ==========

/**
 * Team 运行时
 */
export class TeamRuntime implements AgentRuntime {
  readonly type = 'team' as const
  readonly id: string

  private readonly _options: TeamRuntimeOptions
  private readonly sessionId: string
  private memberAgents = new Map<string, Agent>() // role -> Agent
  private streamEmitter!: IStreamEmitter
  private createdAt: number

  // HITL（Team 暂不支持细粒度审批，预留接口）
  private _interrupted = false

  constructor(options: TeamRuntimeOptions) {
    this._options = options
    this.id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.sessionId = options.sessionId || `session-${Date.now()}`
    this.createdAt = Date.now()
  }

  get name(): string {
    return this._options.name
  }

  get options(): AgentRuntimeOptions {
    return {
      name: this._options.name,
      instructions: `Team: ${this._options.orchestrationType}`
    }
  }

  get interrupted(): boolean {
    return this._interrupted
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 为每个成员创建 Agent
    for (const member of this._options.members) {
      const agent = new Agent({
        name: member.name,
        instructions: member.instructions,
        model: member.model || 'gpt-4o',
        ...(member.modelSettings ? { modelSettings: member.modelSettings } : {}),
        ...(member.tools && member.tools.length > 0 ? { tools: member.tools } : {})
      })
      this.memberAgents.set(member.role, agent)
    }

    // 2. 创建流式发射器
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'team',
      id: this.id,
      name: this.name
    })

    console.log(
      `[TeamRuntime] Initialized: ${this.name} ` +
        `(mode: ${this._options.orchestrationType}, members: ${this._options.members.length})`
    )
  }

  async destroy(): Promise<void> {
    this.memberAgents.clear()
    this._interrupted = false
    console.log(`[TeamRuntime] Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    const maxTurns = (config?.maxTurns as number) ?? this._options.maxTurns ?? 25

    console.log(`[TeamRuntime] Running: ${this.name} (${this._options.orchestrationType})`)

    try {
      let output: string | { summary: string; results: unknown[] }

      switch (this._options.orchestrationType) {
        case 'sequential':
          output = await this.runSequential(input, maxTurns)
          break
        case 'parallel':
          output = await this.runParallel(input, maxTurns)
          break
        case 'planner':
          output = await this.runWithPlanner(input, config)
          break
        default:
          throw new Error(`Unknown orchestration type: ${this._options.orchestrationType}`)
      }

      return {
        output: typeof output === 'string' ? output : JSON.stringify(output),
        duration: Date.now() - startTime,
        metadata: {
          teamId: this.id,
          sessionId: this.sessionId,
          orchestrationType: this._options.orchestrationType,
          memberCount: this._options.members.length
        }
      }
    } catch (error: unknown) {
      console.error(`[TeamRuntime] Execution failed:`, error)
      throw error
    }
  }

  async *stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    console.log(`[TeamRuntime] Running stream: ${this.name}`)

    try {
      // run:start
      await this.streamEmitter.emitStart()
      yield { type: 'run:start', content: '' }

      await this.streamEmitter.emitThinking(
        `Team ${this.name} starting (${this._options.orchestrationType})`
      )

      // turn:start → llm:start → text:start
      yield { type: 'turn:start', content: '', data: { turnIndex: 1 } }
      yield { type: 'llm:start', content: '' }
      yield { type: 'text:start', content: '' }

      const result = await this.run(input, config)

      // text:delta
      await this.streamEmitter.emitText(result.output)
      yield { type: 'text:delta', content: result.output, data: { delta: result.output } }

      // text:done → llm:done → turn:done
      yield { type: 'text:done', content: result.output, data: { text: result.output } }
      yield { type: 'llm:done', content: '' }
      yield { type: 'turn:done', content: '', data: { turnIndex: 1 } }

      // run:done
      await this.streamEmitter.emitDone()
      yield { type: 'run:done', content: '' }

      return result
    } catch (error: unknown) {
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  }

  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const gen = this.stream(input, config)
    let r = await gen.next()
    while (!r.done) {
      onChunk(r.value)
      r = await gen.next()
    }
    return r.value
  }

  // ========== HITL（Team 暂不支持，预留接口） ==========

  approveToolCall(_index: number, _options?: { alwaysApprove?: boolean }): void {
    throw new Error('TeamRuntime does not yet support HITL tool approval')
  }

  rejectToolCall(_index: number, _options?: { alwaysReject?: boolean }): void {
    throw new Error('TeamRuntime does not yet support HITL tool approval')
  }

  // eslint-disable-next-line require-yield
  async *resumeStream(
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    throw new Error('TeamRuntime does not yet support HITL resume')
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: 0,
      metadata: {
        teamId: this.id,
        teamName: this.name,
        memberCount: this._options.members.length
      }
    }
  }

  async clearSession(): Promise<void> {
    console.log(`[TeamRuntime] Clearing session: ${this.sessionId}`)
  }

  // ========== 协作模式实现 ==========

  /**
   * 顺序执行（Chain）
   * 按优先级排序，前一个 Agent 的输出作为下一个的输入
   */
  private async runSequential(input: string, maxTurns: number): Promise<string> {
    let currentOutput = input

    const sortedMembers = [...this._options.members].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    )

    for (const member of sortedMembers) {
      console.log(`[TeamRuntime] Sequential - Running: ${member.role}`)

      const agent = this.memberAgents.get(member.role)
      if (!agent) {
        console.warn(`[TeamRuntime] Member agent not found: ${member.role}`)
        continue
      }

      const result = await run(agent, currentOutput, { maxTurns })
      currentOutput = (result.finalOutput as string) || currentOutput
    }

    return currentOutput
  }

  /**
   * 并行执行
   * 所有 Agent 同时处理同一输入
   */
  private async runParallel(
    input: string,
    maxTurns: number
  ): Promise<{ summary: string; results: unknown[] }> {
    console.log(`[TeamRuntime] Parallel - Running all members`)

    const results = await Promise.all(
      this._options.members.map(async (member) => {
        const agent = this.memberAgents.get(member.role)
        if (!agent) {
          return { role: member.role, output: null }
        }
        const result = await run(agent, input, { maxTurns })
        return { role: member.role, output: result.finalOutput }
      })
    )

    return {
      summary: `Completed ${results.length} parallel tasks`,
      results
    }
  }

  /**
   * Planner 模式
   * 使用 Orchestrator 进行任务分解和调度
   */
  private async runWithPlanner(input: string, config?: ExecutionConfig): Promise<string> {
    console.log(`[TeamRuntime] Planner mode - Using Orchestrator`)

    const { createOrchestrator } = await import('../orchestration')

    const emptyContext: Record<string, unknown> = {}
    const maxRetriesValue = typeof config?.maxRetries === 'number' ? config.maxRetries : 3
    const orchestrator = createOrchestrator({ maxRetries: maxRetriesValue })

    try {
      const task = {
        id: `task-${Date.now()}`,
        objective: input,
        context: (config?.context as Record<string, unknown>) || emptyContext,
        requirements: (config?.requirements as string[]) || []
      }
      const result = await orchestrator.executeTask(task)
      return JSON.stringify(result.subTaskResults || [])
    } finally {
      await orchestrator.cleanup()
    }
  }
}
