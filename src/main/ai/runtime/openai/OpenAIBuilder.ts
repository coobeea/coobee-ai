/**
 * OpenAI Agent Builder
 *
 * 链式 API 构建 OpenAIAgentRuntime。
 * 通过 agentExecutor.openai() 获取。
 */

import path from 'node:path';
import type { AgentRuntime } from '../AgentRuntime';
import type { AgentMode, ToolDefinition, SkillDefinition } from '../types';
import type { OpenAIAgentRuntimeOptions, SessionCompressionOptions } from './types';

export class OpenAIBuilder {
  private _name = 'agent';
  private _mode: AgentMode = 'agent';
  private _instructions = '你是一个 AI 助手。';
  private _appendInstructions: string[] = [];
  private _model?: string;
  private _sessionId?: string;
  private _sessionDir?: string;
  private _tools?: ToolDefinition[];
  private _skills: SkillDefinition[] = [];
  private _maxTurns?: number;
  private _sdkTools?: unknown[];
  private _handoffs?: unknown[];
  private _modelSettings?: Record<string, unknown>;
  private _compression?: SessionCompressionOptions;
  private _contextDir?: string;
  private _workspaceRoot?: string;
  private _sandboxContext?: import('../../tools/types').ToolExecutionContext;

  /** Agent 名称 */
  name(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * 运行模式
   *   - 'chat': 纯对话（无工具、无执行协议、无 Skill）
   *   - 'agent': 完整 Agent（工具 + 执行协议 + Skill + HITL）
   */
  mode(m: AgentMode): this {
    this._mode = m;
    return this;
  }

  /** 获取当前运行模式（供 AgentEnvInjector 读取） */
  getMode(): AgentMode {
    return this._mode;
  }

  /** 获取 Agent 名称（供 AgentEnvInjector 读取） */
  getName(): string {
    return this._name;
  }

  /** 系统指令 */
  instructions(text: string): this {
    this._instructions = text;
    return this;
  }

  /** 追加指令片段 */
  appendInstructions(...texts: string[]): this {
    this._appendInstructions.push(...texts);
    return this;
  }

  /** 模型名称 */
  model(model: string): this {
    this._model = model;
    return this;
  }

  /** 会话 ID（由 Executor 自动设置） */
  sessionId(id: string): this {
    this._sessionId = id;
    return this;
  }

  /** 会话存储根目录 */
  sessionDir(dir: string): this {
    this._sessionDir = dir;
    return this;
  }

  /** 统一工具列表 */
  tools(tools: ToolDefinition[]): this {
    this._tools = tools;
    return this;
  }

  /** 技能列表（累加模式，多次调用会合并） */
  skills(skills: SkillDefinition[]): this {
    this._skills.push(...skills);
    return this;
  }

  /** 最大执行轮次 */
  maxTurns(n: number): this {
    this._maxTurns = n;
    return this;
  }

  /** SDK 原生工具 */
  sdkTools(tools: unknown[]): this {
    this._sdkTools = tools;
    return this;
  }

  /** Handoff 配置 */
  handoffs(handoffs: unknown[]): this {
    this._handoffs = handoffs;
    return this;
  }

  /** 模型参数 */
  modelSettings(settings: Record<string, unknown>): this {
    this._modelSettings = settings;
    return this;
  }

  /** Session 压缩配置 */
  compression(config: SessionCompressionOptions): this {
    this._compression = config;
    return this;
  }

  /** 上下文快照目录（由 injectEnv 自动设置） */
  contextDir(dir: string): this {
    this._contextDir = dir;
    return this;
  }

  /** 工作区根目录（文件工具的路径边界，由 injectEnv 自动设置） */
  workspaceRoot(dir: string): this {
    this._workspaceRoot = dir;
    return this;
  }

  /** 工具执行上下文（由 EnvInjector 自动设置） */
  sandboxContext(ctx: import('../../tools/types').ToolExecutionContext): this {
    this._sandboxContext = ctx;
    return this;
  }

  /** 构建并初始化 Runtime */
  async build(defaultSessionDir?: string): Promise<AgentRuntime> {
    const opts: OpenAIAgentRuntimeOptions = {
      name: this._name,
      instructions: this._instructions,
      model: this._model || process.env.VITE_LLM_MODEL || 'qwen3-max'
    };

    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions;
    if (this._sessionId) opts.sessionId = this._sessionId;
    opts.sessionDir = this._sessionDir || defaultSessionDir || getDefaultSessionDir();
    if (this._tools) opts.tools = this._tools;
    if (this._skills.length) opts.skills = this._skills;
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns;
    if (this._sdkTools) opts.sdkTools = this._sdkTools as OpenAIAgentRuntimeOptions['sdkTools'];
    if (this._handoffs) opts.handoffs = this._handoffs as OpenAIAgentRuntimeOptions['handoffs'];
    if (this._modelSettings) opts.modelSettings = this._modelSettings as OpenAIAgentRuntimeOptions['modelSettings'];
    if (this._compression) opts.compression = this._compression;
    if (this._contextDir) opts.contextDir = this._contextDir;
    if (this._workspaceRoot) opts.workspaceRoot = this._workspaceRoot;
    if (this._sandboxContext) opts.sandboxContext = this._sandboxContext;

    const { OpenAIAgentRuntime } = await import('./index');
    const runtime = new OpenAIAgentRuntime(opts);
    await runtime.initialize();

    return runtime;
  }
}

/**
 * 获取默认 session 存储目录
 */
function getDefaultSessionDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const env = require('@main/common/env') as { Env: { paths: { userData: string } } };
    return path.join(env.Env.paths.userData, 'sessions');
  } catch {
    const home = process.env.HOME || '/tmp';
    return path.join(home, '.coobee-ai', 'sessions');
  }
}
