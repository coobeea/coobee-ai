/**
 * Agent Builder
 *
 * 使用 Builder 模式创建各类 Agent Runtime。
 * 屏蔽底层 SDK 差异和配置细节，提供统一的链式 API。
 *
 * 用法：
 *   const runtime = await AgentBuilder.piMono()
 *     .model('MiniMax-M2.1')
 *     .instructions('你是一个 AI 助手')
 *     .sessionId('abc')
 *     .build()
 *
 * 后续可扩展：
 *   AgentBuilder.openai()   — OpenAI Agent
 *   AgentBuilder.team()     — 多 Agent 编排
 *   AgentBuilder.swarm()    — 群体智能
 */

import type { AgentRuntime } from './runtime/AgentRuntime'
import type { ToolDefinition, SkillDefinition } from './runtime/types'
import type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './runtime/pimono/types'

// ==================== PiMono Builder ====================

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

  /** 会话 ID（不传则自动生成） */
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

  /** 构建并初始化 Runtime */
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

// ==================== 入口 ====================

export const AgentBuilder = {
  /** 创建 Pi-Mono 单 Agent */
  piMono(): PiMonoBuilder {
    return new PiMonoBuilder()
  }

  // 后续扩展：
  // openai(): OpenAIBuilder { return new OpenAIBuilder() }
  // team(): TeamBuilder { return new TeamBuilder() }
  // swarm(): SwarmBuilder { return new SwarmBuilder() }
}
