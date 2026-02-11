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

import { log } from '@main/common/logger'
import type { AgentRuntime } from './runtime/AgentRuntime'
import type { ExecutionResult, StreamChunk, ToolDefinition, SkillDefinition } from './runtime/types'
import type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './runtime/pimono/types'

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
  private _skills?: SkillDefinition[]
  private _maxTurns?: number
  private _useCodingTools?: boolean
  private _cwd?: string
  private _thinkingLevel?: ThinkingLevel
  private _customTools?: unknown[]
  private _compaction?: { enabled?: boolean }
  private _retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }

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

  /** 模型名称（默认从 VITE_MINIMAX_MODEL 读取，兜底 MiniMax-M2.1） */
  model(model: string): this {
    this._model = model
    return this
  }

  /** API Key（默认从 VITE_MINIMAX_API_KEY 读取） */
  apiKey(key: string): this {
    this._apiKey = key
    return this
  }

  /** API Base URL（默认从 VITE_MINIMAX_BASE_URL 读取） */
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

  /** 统一工具列表 */
  tools(tools: ToolDefinition[]): this {
    this._tools = tools
    return this
  }

  /** 技能列表 */
  skills(skills: SkillDefinition[]): this {
    this._skills = skills
    return this
  }

  /** 最大执行轮次 */
  maxTurns(n: number): this {
    this._maxTurns = n
    return this
  }

  /** 是否使用内置代码工具 */
  useCodingTools(enabled: boolean): this {
    this._useCodingTools = enabled
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

  /** SDK 原生工具（高级用法） */
  customTools(tools: unknown[]): this {
    this._customTools = tools
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

  /** 构建并初始化 Runtime（内部方法，由 Executor 调用） */
  async build(): Promise<AgentRuntime> {
    const apiKey = this._apiKey || process.env.VITE_MINIMAX_API_KEY
    if (!apiKey) {
      throw new Error('API Key 未配置：请通过 .apiKey() 或 VITE_MINIMAX_API_KEY 环境变量设置')
    }

    const opts: PiMonoAgentRuntimeOptions = {
      name: this._name,
      instructions: this._instructions,
      apiKey,
      model: this._model || process.env.VITE_MINIMAX_MODEL || 'MiniMax-M2.1',
      baseURL: this._baseURL || process.env.VITE_MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1'
    }

    // 可选字段：仅在设置时传入，避免覆盖 Runtime 的默认值
    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions
    if (this._sessionId) opts.sessionId = this._sessionId
    if (this._sessionMode) opts.sessionMode = this._sessionMode
    if (this._tools) opts.tools = this._tools
    if (this._skills) opts.skills = this._skills
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns
    if (this._useCodingTools !== undefined) opts.useCodingTools = this._useCodingTools
    if (this._cwd) opts.cwd = this._cwd
    if (this._thinkingLevel) opts.thinkingLevel = this._thinkingLevel
    if (this._customTools) opts.customTools = this._customTools
    if (this._compaction) opts.compaction = this._compaction
    if (this._retry) opts.retry = this._retry

    // 动态导入，避免顶层加载 SDK
    const { PiMonoAgentRuntime } = await import('./runtime/pimono')
    const runtime = new PiMonoAgentRuntime(opts)
    await runtime.initialize()

    return runtime
  }
}

// ==================== 类型定义 ====================

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** Builder 实例（通过 agentExecutor.piMono() 创建） */
  builder: PiMonoBuilder
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

  // ========== Builder 工厂 ==========

  /** 创建 PiMono Agent Builder */
  piMono(): PiMonoBuilder {
    return new PiMonoBuilder()
  }

  // 后续扩展：
  // openai(): OpenAIBuilder { return new OpenAIBuilder() }
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

  // ========== 流式执行（SSE 透传） ==========

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
      // 1. 创建 Runtime
      runtime = await builder.sessionId(sessionId).build()

      // 2. 透传 stream()
      const gen = runtime.stream(message)
      let r = await gen.next()
      while (!r.done) {
        yield r.value
        r = await gen.next()
      }

      log.info(
        `[AgentExecutor] Stream completed: sessionId=${sessionId}, output=${r.value.output.slice(0, 100)}...`
      )

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
   * 核心执行流程：创建 → 推理 → 销毁
   *
   * 每次调用都是一个完整的无状态生命周期：
   * 1. 通过 Builder 创建并初始化 Runtime
   * 2. 执行 stream()
   * 3. 函数返回后 Runtime 由 GC 回收
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk } = request
    let runtime: AgentRuntime | null = null

    log.info(
      `[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`
    )
    const startTime = Date.now()

    try {
      // 1. 创建 Runtime（Builder 内部调用 initialize）
      runtime = await builder.sessionId(sessionId).build()

      // 2. 流式执行 — 通过 stream() generator
      const chunkCallback = onChunk || (() => {})
      const gen = runtime.stream(message)
      let r = await gen.next()
      while (!r.done) {
        chunkCallback(r.value)
        r = await gen.next()
      }
      const result = r.value

      const duration = Date.now() - startTime
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}, duration=${duration}ms, output=${result.output.slice(0, 100)}...`
      )

      return result
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms, ${msg}`)
      throw error
    } finally {
      // 3. 销毁 Runtime（释放资源）
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
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor()
