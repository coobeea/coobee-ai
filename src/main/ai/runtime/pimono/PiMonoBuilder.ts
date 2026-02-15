/**
 * PiMono Agent Builder
 *
 * 链式 API 构建 PiMonoAgentRuntime。
 * 通过 agentExecutor.piMono() 获取。
 */

import path from 'node:path'
import type { AgentRuntime } from '../AgentRuntime'
import type { AgentMode, ToolDefinition, SkillDefinition } from '../types'
import type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './types'

export class PiMonoBuilder {
  private _name = 'agent'
  private _mode: AgentMode = 'agent'
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
  private _sandboxContext?: import('../../sandbox/types').SandboxContext

  /** Agent 名称 */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * 运行模式
   *   - 'chat': 纯对话（无工具、无执行协议、无 Skill）
   *   - 'agent': 完整 Agent（工具 + 执行协议 + Skill + HITL）
   */
  mode(m: AgentMode): this {
    this._mode = m
    return this
  }

  /** 获取当前运行模式（供 AgentEnvInjector 读取） */
  getMode(): AgentMode {
    return this._mode
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

  /** 工作目录（与 OpenAIBuilder.workspaceRoot() 对齐） */
  cwd(dir: string): this {
    this._cwd = dir
    return this
  }

  /** 工作区根目录（cwd 的别名，统一 Builder API） */
  workspaceRoot(dir: string): this {
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

  /** 沙箱上下文（由 EnvInjector 自动设置） */
  sandboxContext(ctx: import('../../sandbox/types').SandboxContext): this {
    this._sandboxContext = ctx
    return this
  }

  /** 构建并初始化 Runtime（内部方法，由 Executor 调用） */
  async build(defaultSessionDir?: string): Promise<AgentRuntime> {
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
    // sessionDir: 显式传入 > 默认值
    opts.sessionDir = this._sessionDir || defaultSessionDir || getDefaultSessionDir()
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
    if (this._sandboxContext) opts.sandboxContext = this._sandboxContext

    // 动态导入，避免顶层加载 SDK
    const { PiMonoAgentRuntime } = await import('./index')
    const runtime = new PiMonoAgentRuntime(opts)
    await runtime.initialize()

    return runtime
  }
}

/**
 * 获取默认 session 存储目录
 */
function getDefaultSessionDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const env = require('@main/common/env') as { Env: { paths: { userData: string } } }
    return path.join(env.Env.paths.userData, 'sessions')
  } catch {
    const home = process.env.HOME || '/tmp'
    return path.join(home, '.coobee-ai', 'sessions')
  }
}
