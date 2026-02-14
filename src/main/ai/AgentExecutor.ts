/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，负责：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. 内置 Builder — 通过 agentExecutor.piMono() 创建 Builder
 *
 * 设计哲学（参考 OpenClaw pi-integration-architecture）：
 *   - 消息驱动：每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程
 *   - 无状态实例：Runtime 对象用完即丢，由 GC 回收
 *   - 有状态存储：会话连续性靠 JSONL 文件持久化（SDK 自动管理）
 *
 * 用法：
 *   agentExecutor.submit({
 *     sessionId: 'abc',
 *     message: 'hello',
 *     builder: agentExecutor.piMono()
 *       .name('chat-agent')
 *       .instructions('你是一个 AI 助手')
 *       .sessionMode('file')
 *   })
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@main/common/logger'

/** AI 专属日志 — 写入 logs/ai.log，便于 AI 相关问题排查 */
const log = createLogger('ai')
import type { AgentRuntime } from './runtime/AgentRuntime'
import type { ExecutionResult, StreamChunk, ToolDefinition, SkillDefinition } from './runtime/types'
import type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './runtime/pimono/types'
import type { OpenAIAgentRuntimeOptions, SessionCompressionOptions } from './runtime/openai/types'
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter'
import type { StreamSource } from './streaming/types'
import { hitlApprovalManager, DEFAULT_HITL_TIMEOUT_MS } from './hitl/HitlApprovalManager'
import { buildAgentEnv, formatRuntimePaths, loadRuntimeEnvSkill } from './common/AgentEnv'

// ==================== Builder ====================

/**
 * PiMono Agent Builder
 *
 * 链式 API 构建 PiMonoAgentRuntime。
 * 不直接暴露，通过 agentExecutor.piMono() 获取。
 */
export class PiMonoBuilder {
  private _name = 'agent'
  private _instructions = '你是一个 AI 助手。'
  private _appendInstructions: string[] = []
  private _model?: string
  private _apiKey?: string
  private _baseURL?: string
  private _sessionId?: string
  private _sessionMode?: 'memory' | 'file'
  private _tools?: ToolDefinition[]
  private _skills: SkillDefinition[] = []
  private _maxTurns?: number
  private _cwd?: string
  private _thinkingLevel?: ThinkingLevel
  private _sdkTools?: unknown[]
  private _sessionDir?: string
  private _compaction?: { enabled?: boolean }
  private _retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }
  private _contextDir?: string

  /** Agent 名称 */
  name(name: string): this {
    this._name = name
    return this
  }

  /** 系统指令 */
  instructions(text: string): this {
    this._instructions = text
    return this
  }

  /** 追加指令片段 */
  appendInstructions(...texts: string[]): this {
    this._appendInstructions.push(...texts)
    return this
  }

  /** 模型名称（默认从 VITE_LLM_MODEL 读取，兜底 MiniMax-M2.1） */
  model(model: string): this {
    this._model = model
    return this
  }

  /** API Key（默认从 VITE_LLM_API_KEY 读取） */
  apiKey(key: string): this {
    this._apiKey = key
    return this
  }

  /** API Base URL（默认从 VITE_LLM_BASE_URL 读取） */
  baseURL(url: string): this {
    this._baseURL = url
    return this
  }

  /** 会话 ID（由 Executor 自动设置，一般不需要手动调用） */
  sessionId(id: string): this {
    this._sessionId = id
    return this
  }

  /** 会话持久化模式（默认 memory） */
  sessionMode(mode: 'memory' | 'file'): this {
    this._sessionMode = mode
    return this
  }

  /** 会话存储根目录（不传则由 Executor 注入默认值） */
  sessionDir(dir: string): this {
    this._sessionDir = dir
    return this
  }

  /** 统一工具列表 */
  tools(tools: ToolDefinition[]): this {
    this._tools = tools
    return this
  }

  /** 技能列表（累加模式，多次调用会合并） */
  skills(skills: SkillDefinition[]): this {
    this._skills.push(...skills)
    return this
  }

  /** 最大执行轮次 */
  maxTurns(n: number): this {
    this._maxTurns = n
    return this
  }

  /** 工作目录 */
  cwd(dir: string): this {
    this._cwd = dir
    return this
  }

  /** 思考级别 */
  thinkingLevel(level: ThinkingLevel): this {
    this._thinkingLevel = level
    return this
  }

  /** SDK 原生工具（与 OpenAI Builder 的 sdkTools 命名统一） */
  sdkTools(tools: unknown[]): this {
    this._sdkTools = tools
    return this
  }

  /** 压缩配置 */
  compaction(config: { enabled?: boolean }): this {
    this._compaction = config
    return this
  }

  /** 重试配置 */
  retry(config: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }): this {
    this._retry = config
    return this
  }

  /** 上下文快照目录（由 injectEnv 自动设置） */
  contextDir(dir: string): this {
    this._contextDir = dir
    return this
  }

  /** 构建并初始化 Runtime（内部方法，由 Executor 调用） */
  async build(): Promise<AgentRuntime> {
    const apiKey = this._apiKey || process.env.VITE_LLM_API_KEY
    if (!apiKey) {
      throw new Error('API Key 未配置：请通过 .apiKey() 或 VITE_LLM_API_KEY 环境变量设置')
    }

    const opts: PiMonoAgentRuntimeOptions = {
      name: this._name,
      instructions: this._instructions,
      apiKey,
      model: this._model || process.env.VITE_LLM_MODEL || 'MiniMax-M2.1',
      baseURL: this._baseURL || process.env.VITE_LLM_BASE_URL || 'https://api.minimaxi.com/v1'
    }

    // 可选字段：仅在设置时传入，避免覆盖 Runtime 的默认值
    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions
    if (this._sessionId) opts.sessionId = this._sessionId
    if (this._sessionMode) opts.sessionMode = this._sessionMode
    // sessionDir: 显式传入 > Executor 默认值
    opts.sessionDir = this._sessionDir || AgentExecutor.getDefaultSessionDir()
    if (this._tools) opts.tools = this._tools
    if (this._skills.length) opts.skills = this._skills
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns
    if (this._cwd) {
      opts.cwd = this._cwd
      opts.workspaceRoot = this._cwd
    }
    if (this._thinkingLevel) opts.thinkingLevel = this._thinkingLevel
    if (this._sdkTools) opts.sdkTools = this._sdkTools
    if (this._compaction) opts.compaction = this._compaction
    if (this._retry) opts.retry = this._retry
    if (this._contextDir) opts.contextDir = this._contextDir

    // 动态导入，避免顶层加载 SDK
    const { PiMonoAgentRuntime } = await import('./runtime/pimono')
    const runtime = new PiMonoAgentRuntime(opts)
    await runtime.initialize()

    return runtime
  }
}

// ==================== OpenAI Builder ====================

/**
 * OpenAI Agent Builder
 *
 * 链式 API 构建 OpenAIAgentRuntime。
 * 不直接暴露，通过 agentExecutor.openai() 获取。
 */
export class OpenAIBuilder {
  private _name = 'agent'
  private _instructions = '你是一个 AI 助手。'
  private _appendInstructions: string[] = []
  private _model?: string
  private _sessionId?: string
  private _sessionDir?: string
  private _tools?: ToolDefinition[]
  private _skills: SkillDefinition[] = []
  private _maxTurns?: number
  private _sdkTools?: unknown[]
  private _handoffs?: unknown[]
  private _modelSettings?: Record<string, unknown>
  private _compression?: SessionCompressionOptions
  private _contextDir?: string
  private _workspaceRoot?: string

  /** Agent 名称 */
  name(name: string): this {
    this._name = name
    return this
  }

  /** 系统指令 */
  instructions(text: string): this {
    this._instructions = text
    return this
  }

  /** 追加指令片段 */
  appendInstructions(...texts: string[]): this {
    this._appendInstructions.push(...texts)
    return this
  }

  /** 模型名称 */
  model(model: string): this {
    this._model = model
    return this
  }

  /** 会话 ID（由 Executor 自动设置） */
  sessionId(id: string): this {
    this._sessionId = id
    return this
  }

  /** 会话存储根目录 */
  sessionDir(dir: string): this {
    this._sessionDir = dir
    return this
  }

  /** 统一工具列表 */
  tools(tools: ToolDefinition[]): this {
    this._tools = tools
    return this
  }

  /** 技能列表（累加模式，多次调用会合并） */
  skills(skills: SkillDefinition[]): this {
    this._skills.push(...skills)
    return this
  }

  /** 最大执行轮次 */
  maxTurns(n: number): this {
    this._maxTurns = n
    return this
  }

  /** SDK 原生工具 */
  sdkTools(tools: unknown[]): this {
    this._sdkTools = tools
    return this
  }

  /** Handoff 配置 */
  handoffs(handoffs: unknown[]): this {
    this._handoffs = handoffs
    return this
  }

  /** 模型参数 */
  modelSettings(settings: Record<string, unknown>): this {
    this._modelSettings = settings
    return this
  }

  /** Session 压缩配置 */
  compression(config: SessionCompressionOptions): this {
    this._compression = config
    return this
  }

  /** 上下文快照目录（由 injectEnv 自动设置） */
  contextDir(dir: string): this {
    this._contextDir = dir
    return this
  }

  /** 工作区根目录（文件工具的路径边界，由 injectEnv 自动设置） */
  workspaceRoot(dir: string): this {
    this._workspaceRoot = dir
    return this
  }

  /** 构建并初始化 Runtime */
  async build(): Promise<AgentRuntime> {
    const opts: OpenAIAgentRuntimeOptions = {
      name: this._name,
      instructions: this._instructions,
      model: this._model || process.env.VITE_LLM_MODEL || 'MiniMax-M2.1'
    }

    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions
    if (this._sessionId) opts.sessionId = this._sessionId
    opts.sessionDir = this._sessionDir || AgentExecutor.getDefaultSessionDir()
    if (this._tools) opts.tools = this._tools
    if (this._skills.length) opts.skills = this._skills
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns
    if (this._sdkTools) opts.sdkTools = this._sdkTools as OpenAIAgentRuntimeOptions['sdkTools']
    if (this._handoffs) opts.handoffs = this._handoffs as OpenAIAgentRuntimeOptions['handoffs']
    if (this._modelSettings)
      opts.modelSettings = this._modelSettings as OpenAIAgentRuntimeOptions['modelSettings']
    if (this._compression) opts.compression = this._compression
    if (this._contextDir) opts.contextDir = this._contextDir
    if (this._workspaceRoot) opts.workspaceRoot = this._workspaceRoot

    const { OpenAIAgentRuntime } = await import('./runtime/openai')
    const runtime = new OpenAIAgentRuntime(opts)
    await runtime.initialize()

    return runtime
  }
}

// ==================== 类型定义 ====================

/** 支持的 Builder 类型 */
export type AgentBuilder = PiMonoBuilder | OpenAIBuilder

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** Builder 实例（通过 agentExecutor.piMono() 或 agentExecutor.openai() 创建） */
  builder: AgentBuilder
  /** 流式事件回调（可选） */
  onChunk?: (chunk: StreamChunk) => void
}

/** 执行状态 */
export interface SessionStatus {
  /** 是否正在执行 */
  busy: boolean
  /** 开始时间（busy 时有值） */
  startedAt?: number
}

// ==================== AgentExecutor ====================

class AgentExecutor {
  /** 正在执行的 session 集合 */
  private busySessions = new Map<string, { startedAt: number }>()

  /**
   * 获取默认 session 存储目录
   *
   * 优先使用 Electron Env.paths.userData/sessions，
   * fallback 到 ~/.coobee-ai/sessions（测试/非 Electron 环境）。
   */
  static getDefaultSessionDir(): string {
    try {
      // 延迟导入 Env：避免测试环境中 Electron app 未初始化的问题
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const env = require('@main/common/env') as { Env: { paths: { userData: string } } }
      return path.join(env.Env.paths.userData, 'sessions')
    } catch {
      const home = process.env.HOME || '/tmp'
      return path.join(home, '.coobee-ai', 'sessions')
    }
  }

  // ========== Builder 工厂 ==========

  /** 创建 PiMono Agent Builder */
  piMono(): PiMonoBuilder {
    return new PiMonoBuilder()
  }

  /** 创建 OpenAI Agent Builder */
  openai(): OpenAIBuilder {
    return new OpenAIBuilder()
  }

  // 后续扩展：
  // team(): TeamBuilder { return new TeamBuilder() }
  // swarm(): SwarmBuilder { return new SwarmBuilder() }

  // ========== 提交执行 ==========

  /**
   * 提交执行请求（非阻塞）
   *
   * 立即返回状态，流式事件通过 StreamEmitter → EventBus → WebSocket 推送。
   * 如果 session 正在执行中，返回 busy 错误。
   */
  submit(
    request: ExecuteRequest
  ): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string } {
    const { sessionId } = request

    if (this.busySessions.has(sessionId)) {
      log.warn(`[AgentExecutor] Session busy: ${sessionId}`)
      return { status: 'busy', sessionId }
    }

    // 标记为 busy
    this.busySessions.set(sessionId, { startedAt: Date.now() })

    // 后台执行（不阻塞调用方）
    this.execute(request)
      .catch((error: unknown) => {
        log.error(`[AgentExecutor] Execution failed: sessionId=${sessionId}`, error)
      })
      .finally(() => {
        this.busySessions.delete(sessionId)
      })

    return { status: 'accepted', sessionId }
  }

  /**
   * 提交并等待执行完成（阻塞）
   *
   * 适用于需要同步获取结果的场景（如测试）。
   */
  async submitAndWait(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId } = request

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`)
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() })
    try {
      return await this.execute(request)
    } finally {
      this.busySessions.delete(sessionId)
    }
  }

  // ========== 状态查询 ==========

  /** 查询 session 状态 */
  getStatus(sessionId: string): SessionStatus {
    const info = this.busySessions.get(sessionId)
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false }
  }

  /** 获取所有活跃 session */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.busySessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }))
  }

  // ========== 环境注入 ==========

  /**
   * 在 Builder 构建前注入运行时环境
   *
   * 自动完成：
   *   1. 获取/创建 Agent 工作空间
   *   2. 加载 runtime-env Skill 注入到 Builder
   *   3. 注入 <runtime_paths> 到 appendInstructions
   *
   * @param sessionId 会话 ID（用于生成工作空间）
   * @param builder   Builder 实例（PiMono 或 OpenAI）
   */
  private async injectEnv(sessionId: string, builder: AgentBuilder): Promise<string | undefined> {
    try {
      // 延迟导入 Env，避免测试环境问题
      const { Env } = await import('@main/common/env')

      // 1. 获取/创建工作空间
      const workspace = await Env.getAgentWorkspaceDir(sessionId)

      // 2. 构建 AgentEnv
      const agentEnv = await buildAgentEnv(sessionId, workspace)

      // 3. 加载 runtime-env Skill
      const envSkill = await loadRuntimeEnvSkill(Env.paths.builtinSkillsDir)
      if (envSkill) {
        builder.skills([envSkill])
      }

      // 4. 注入 <runtime_paths> 到 appendInstructions
      const runtimePathsBlock = formatRuntimePaths(agentEnv)
      builder.appendInstructions(runtimePathsBlock)

      // 5. 设置会话存储目录（指向 workspace 内的 sessions/）
      builder.sessionDir(path.join(workspace, 'sessions'))

      // 6. 设置工作目录
      if (builder instanceof PiMonoBuilder) {
        builder.cwd(workspace)
      }
      if (builder instanceof OpenAIBuilder) {
        builder.workspaceRoot(workspace)
      }

      // 7. 设置上下文快照目录（Runtime 层写入）
      builder.contextDir(path.join(workspace, 'contexts'))

      log.info(`[AgentExecutor] Env injected: sessionId=${sessionId}, workspace=${workspace}`)
      return workspace
    } catch (error) {
      // 环境注入失败不阻断执行，仅记录警告
      log.warn(`[AgentExecutor] Env injection failed, continuing without env:`, error)
      return undefined
    }
  }

  // ========== 事件记录 ==========

  /**
   * 将 StreamChunk 追加写入 events.jsonl
   *
   * 每个 session 一个文件，所有执行的事件按时间线累积。
   * JSONL 格式：每行一个 JSON 对象，便于 grep/分析。
   *
   * @param eventsFile 事件文件路径（null 则跳过）
   * @param chunk      流式事件
   * @param seq        本次执行内的序号
   */
  private appendEvent(eventsFile: string | null, chunk: StreamChunk, seq: number): void {
    if (!eventsFile) return
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        seq,
        type: chunk.type,
        content: chunk.content,
        ...(chunk.data ? { data: chunk.data } : {})
      })
      fs.appendFileSync(eventsFile, line + '\n')
    } catch {
      // 写入失败不阻断流式执行
    }
  }

  /**
   * 获取事件文件路径
   *
   * @param workspace 工作空间路径（undefined 则返回 null）
   * @returns events/events.jsonl 的完整路径，或 null
   */
  private getEventsFile(workspace: string | undefined): string | null {
    return workspace ? path.join(workspace, 'events', 'events.jsonl') : null
  }

  // ========== 流式执行（SSE 透传） ==========

  /**
   * 创建 StreamEmitter 用于将 StreamChunk 广播到 EventBus
   */
  private createEmitter(sessionId: string, runtime: AgentRuntime): IStreamEmitter {
    const source: StreamSource = {
      type: runtime.type,
      id: runtime.id,
      name: runtime.name
    }
    return createStreamEmitter(sessionId, source)
  }

  /**
   * 流式执行 — AsyncGenerator 透传
   *
   * 供 SSE 端点直接 yield* 使用：
   *   @SSE()
   *   async *chatStream(message, sessionId) {
   *     yield* agentExecutor.stream({ sessionId, message, builder: ... })
   *   }
   *
   * 内部管理完整的 busy 锁 + 创建 → stream() → 销毁 生命周期。
   * 每个 chunk 同时通过 StreamEmitter.forward() 广播到 EventBus。
   */
  async *stream(
    request: Omit<ExecuteRequest, 'onChunk'>
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId, message, builder } = request

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`)
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() })
    let runtime: AgentRuntime | null = null

    log.info(`[AgentExecutor] Stream: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`)

    try {
      // 0. 注入运行时环境（含 contextDir，Runtime 层自行写入快照）
      const workspace = await this.injectEnv(sessionId, builder)
      const eventsFile = this.getEventsFile(workspace)

      // 1. 创建 Runtime
      runtime = await builder.sessionId(sessionId).build()
      const emitter = this.createEmitter(sessionId, runtime)

      // 2. 透传 stream()，同时 forward 到 EventBus + 写入 events.jsonl
      const gen = runtime.stream(message)
      let eventSeq = 0
      let r = await gen.next()
      while (!r.done) {
        emitter.forward(r.value)
        this.appendEvent(eventsFile, r.value, ++eventSeq)
        // 记录 API 错误（SDK 内部错误不 throw，通过 run:error chunk 传递）
        if (r.value.type === 'run:error') {
          log.error(`[AgentExecutor] API error: sessionId=${sessionId}, error=${r.value.content}`)
        }
        yield r.value
        r = await gen.next()
      }

      // 完成日志：区分成功与错误
      if (r.value.error) {
        log.error(
          `[AgentExecutor] Stream failed: sessionId=${sessionId}, ` +
            `duration=${Date.now() - (this.busySessions.get(sessionId)?.startedAt || Date.now())}ms, ` +
            `error=${r.value.error}`
        )
      } else {
        log.info(
          `[AgentExecutor] Stream completed: sessionId=${sessionId}, output=${r.value.output.slice(0, 100)}...`
        )
      }

      return r.value
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Stream error: sessionId=${sessionId}, ${msg}`)
      throw error
    } finally {
      // 3. 销毁 Runtime
      if (runtime) {
        try {
          await runtime.destroy()
        } catch (e: unknown) {
          log.warn(`[AgentExecutor] Runtime destroy warning: ${e}`)
        }
      }
      runtime = null
      this.busySessions.delete(sessionId)
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并 forward 到 EventBus + 写入 events.jsonl
   *
   * 返回 generator 的最终返回值（ExecutionResult）。
   */
  private async consumeAndForward(
    gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
    emitter: IStreamEmitter,
    onChunk?: (chunk: StreamChunk) => void,
    eventsFile?: string | null
  ): Promise<ExecutionResult> {
    let eventSeq = 0
    let r = await gen.next()
    while (!r.done) {
      emitter.forward(r.value)
      this.appendEvent(eventsFile || null, r.value, ++eventSeq)
      // 记录 API 错误事件
      if (r.value.type === 'run:error') {
        log.error(`[AgentExecutor] API error in execute: error=${r.value.content}`)
      }
      onChunk?.(r.value)
      r = await gen.next()
    }
    return r.value
  }

  /**
   * 核心执行流程：创建 → 推理 → [HITL 循环] → 销毁
   *
   * 每次调用都是一个完整的无状态生命周期：
   * 1. 通过 Builder 创建并初始化 Runtime
   * 2. 执行 stream()
   * 3. 如果 HITL 中断，await Promise 等待前端决策，然后自动恢复
   * 4. 函数返回后 Runtime 由 GC 回收
   *
   * HITL 循环（Promise 等待模式）：
   *   当 runtime.stream() 返回 interrupted 结果时，执行循环不退出，
   *   而是 await hitlApprovalManager.waitForDecisions()。
   *   前端通过 API 提交决策后，Promise resolve，执行循环自动恢复。
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk } = request
    let runtime: AgentRuntime | null = null

    log.info(
      `[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`
    )
    const startTime = Date.now()

    try {
      // 0. 注入运行时环境（含 contextDir，Runtime 层自行写入快照）
      const workspace = await this.injectEnv(sessionId, builder)
      const eventsFile = this.getEventsFile(workspace)

      // === Extension Hooks: message_received + session_start + before_agent_start ===
      await this.runExtensionHooks(sessionId, message, builder)

      // 1. 创建 Runtime（Builder 内部调用 initialize）
      runtime = await builder.sessionId(sessionId).build()
      const emitter = this.createEmitter(sessionId, runtime)

      // 2. 初始 stream
      const gen = runtime.stream(message)
      let result = await this.consumeAndForward(gen, emitter, onChunk, eventsFile)

      // 3. HITL 循环（可能多轮中断-恢复）
      while (result.interrupted && result.interruptions?.length) {
        log.info(
          `[AgentExecutor] HITL interrupted: sessionId=${sessionId}, tools=${result.interruptions.length}`
        )

        // 3a. forward interrupted 事件
        emitter.forward({ type: 'run:interrupted', content: '' })

        // 3b. await Promise — 暂停在此处等待前端决策
        const decisions = await hitlApprovalManager.waitForDecisions(
          sessionId,
          result.interruptions.length,
          DEFAULT_HITL_TIMEOUT_MS
        )

        // 3c. 超时处理
        if (!decisions) {
          log.warn(`[AgentExecutor] HITL timeout: sessionId=${sessionId}`)
          emitter.forward({ type: 'run:error', content: 'HITL approval timeout' })
          return { ...result, output: 'HITL approval timeout' }
        }

        // 3d. Apply decisions to runtime
        for (let i = 0; i < decisions.length; i++) {
          if (decisions[i] === 'reject') {
            runtime.rejectToolCall(i)
          } else {
            runtime.approveToolCall(i, {
              alwaysApprove: decisions[i] === 'approve-always'
            })
          }
        }

        log.info(
          `[AgentExecutor] HITL resumed: sessionId=${sessionId}, decisions=${JSON.stringify(decisions)}`
        )

        // 3e. Resume stream — 继续执行
        const resumeGen = runtime.resumeStream()
        result = await this.consumeAndForward(resumeGen, emitter, onChunk, eventsFile)
        // 如果 result.interrupted 再次为 true，while 循环继续
      }

      const duration = Date.now() - startTime

      // === Extension Hooks: agent_end + session_end ===
      await this.runExtensionEndHooks(sessionId, result, duration)

      if (result.error) {
        log.error(
          `[AgentExecutor] Failed: sessionId=${sessionId}, duration=${duration}ms, error=${result.error}`
        )
      } else {
        log.info(
          `[AgentExecutor] Completed: sessionId=${sessionId}, duration=${duration}ms, output=${result.output.slice(0, 100)}...`
        )
      }

      return result
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms, ${msg}`)
      // 确保 HITL 等待也被清理
      hitlApprovalManager.cleanup(sessionId)
      throw error
    } finally {
      // 4. 销毁 Runtime（释放资源）
      if (runtime) {
        try {
          await runtime.destroy()
        } catch (e: unknown) {
          log.warn(`[AgentExecutor] Runtime destroy warning: ${e}`)
        }
      }
      runtime = null // 确保 GC 可回收
    }
  }

  // ========== Extension Hook 辅助方法 ==========

  /**
   * 执行 Extension 前置 Hook
   * message_received → session_start → before_agent_start
   */
  private async runExtensionHooks(
    sessionId: string,
    message: string,
    builder: AgentBuilder
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension')
      const runner = ExtensionManager.getHookRunner()
      if (!runner) return

      // message_received (void)
      await runner.runVoidHook('message_received', { sessionId, message })

      // session_start (void)
      await runner.runVoidHook('session_start', { sessionId })

      // before_agent_start (modifying)
      const result = await runner.runModifyingHook('before_agent_start', {
        sessionId,
        prompt: message
      })
      if (result) {
        if (result.prependContext) {
          builder.appendInstructions(result.prependContext)
        }
        if (result.replaceSystemPrompt) {
          builder.instructions(result.replaceSystemPrompt)
        }
      }
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (start) failed:', err)
    }
  }

  /**
   * 执行 Extension 后置 Hook
   * agent_end → session_end
   */
  private async runExtensionEndHooks(
    sessionId: string,
    result: ExecutionResult,
    durationMs: number
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension')
      const runner = ExtensionManager.getHookRunner()
      if (!runner) return

      // agent_end (void)
      await runner.runVoidHook('agent_end', {
        sessionId,
        success: !result.error,
        output: result.output,
        durationMs
      })

      // session_end (void)
      await runner.runVoidHook('session_end', { sessionId })
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (end) failed:', err)
    }
  }
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor()
