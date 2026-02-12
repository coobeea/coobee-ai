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
import { log } from '@main/common/logger'
import { AbstractAgentRuntime, generateRuntimeId } from '../runtime/AbstractAgentRuntime'
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
export class TeamRuntime extends AbstractAgentRuntime {
  readonly type = 'team' as const
  readonly id: string

  private readonly _options: TeamRuntimeOptions
  private readonly sessionId: string
  private memberAgents = new Map<string, Agent>() // role -> Agent
  private createdAt: number

  // HITL（Team 暂不支持细粒度审批，预留接口）
  private _interrupted = false

  constructor(options: TeamRuntimeOptions) {
    super()
    this._options = options
    this.id = generateRuntimeId('team')
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

  get supportsHITL(): boolean {
    return false
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

    log.info(
      `[TeamRuntime] Initialized: ${this.name} ` +
        `(mode: ${this._options.orchestrationType}, members: ${this._options.members.length})`
    )
  }

  async destroy(): Promise<void> {
    this.memberAgents.clear()
    this._interrupted = false
    log.info(`[TeamRuntime] Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    const maxTurns = (config?.maxTurns as number) ?? this._options.maxTurns ?? 25

    log.info(`[TeamRuntime] Running: ${this.name} (${this._options.orchestrationType})`)

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
      log.error(`[TeamRuntime] Execution failed:`, error)
      throw error
    }
  }

  /**
   * 流式执行
   *
   * 对于 sequential 模式，逐成员执行并透传每个成员的输出
   * （每个成员的结果作为一个 turn 增量输出，非全部完成后一次性吐出）。
   *
   * 对于 parallel / planner 模式，仍是阻塞等待后一次性输出
   * （因为并行执行的中间结果无法线性化为流式事件）。
   */
  async *stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    log.info(`[TeamRuntime] Running stream: ${this.name}`)
    const startTime = Date.now()

    try {
      yield { type: 'run:start', content: '' }

      // sequential 模式支持真正的增量流式
      if (this._options.orchestrationType === 'sequential') {
        const result = yield* this.streamSequential(input, config)
        yield { type: 'run:done', content: '' }
        return result
      }

      // parallel / planner 模式：阻塞等待后输出
      yield { type: 'turn:start', content: '', data: { turnIndex: 1 } }
      yield { type: 'llm:start', content: '' }
      yield { type: 'text:start', content: '' }

      const result = await this.run(input, config)

      yield { type: 'text:delta', content: result.output, data: { delta: result.output } }
      yield { type: 'text:done', content: result.output, data: { text: result.output } }
      yield { type: 'llm:done', content: '' }
      yield { type: 'turn:done', content: '', data: { turnIndex: 1 } }
      yield { type: 'run:done', content: '' }

      return { ...result, duration: Date.now() - startTime }
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  }

  /**
   * Sequential 模式的增量流式
   *
   * 每个成员执行作为一个独立的 turn，输出增量可见：
   *   turn:start(1) → text:delta → turn:done(1) →
   *   turn:start(2) → text:delta → turn:done(2) → ...
   */
  private async *streamSequential(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now()
    const maxTurns = (config?.maxTurns as number) ?? this._options.maxTurns ?? 25
    let currentOutput = input
    let turnIndex = 0

    const sortedMembers = [...this._options.members].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    )

    for (const member of sortedMembers) {
      turnIndex++
      const agent = this.memberAgents.get(member.role)
      if (!agent) {
        log.warn(`[TeamRuntime] Member agent not found: ${member.role}`)
        continue
      }

      yield { type: 'turn:start', content: '', data: { turnIndex } }
      yield {
        type: 'handoff:start',
        content: member.name,
        data: { fromAgent: 'team', toAgent: member.name },
        agentName: member.name
      }
      yield { type: 'llm:start', content: '' }
      yield { type: 'text:start', content: '' }

      const result = await run(agent, currentOutput, { maxTurns })
      const memberOutput = (result.finalOutput as string) || currentOutput

      yield { type: 'text:delta', content: memberOutput, data: { delta: memberOutput } }
      yield { type: 'text:done', content: memberOutput, data: { text: memberOutput } }
      yield { type: 'llm:done', content: '' }
      yield { type: 'turn:done', content: '', data: { turnIndex } }

      currentOutput = memberOutput
    }

    return {
      output: currentOutput,
      duration: Date.now() - startTime,
      metadata: {
        teamId: this.id,
        sessionId: this.sessionId,
        orchestrationType: this._options.orchestrationType,
        memberCount: this._options.members.length
      }
    }
  }

  // runStream() and HITL methods inherited from AbstractAgentRuntime

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
    log.info(`[TeamRuntime] Clearing session: ${this.sessionId}`)
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
      log.info(`[TeamRuntime] Sequential - Running: ${member.role}`)

      const agent = this.memberAgents.get(member.role)
      if (!agent) {
        log.warn(`[TeamRuntime] Member agent not found: ${member.role}`)
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
    log.info(`[TeamRuntime] Parallel - Running all members`)

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
    log.info(`[TeamRuntime] Planner mode - Using Orchestrator`)

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
