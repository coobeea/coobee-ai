/**
 * Base Agent Builder
 *
 * 抽象基类，封装 PiMonoBuilder 与 OpenAIBuilder 的共享字段和方法。
 * 子类实现 build() 完成具体 Runtime 的构建。
 */

import path from 'node:path';

import type { ProviderConfig } from '@main/ai/provider/types';

import type { AgentRuntime } from './AgentRuntime';
import type { AgentMode, ToolDefinition, SkillDefinition } from './types';

export abstract class BaseAgentBuilder {
  protected _name = 'agent';
  protected _mode: AgentMode = 'agent';
  protected _instructions = '你是一个 AI 助手。';
  protected _appendInstructions: string[] = [];
  protected _model?: string;
  protected _sessionId?: string;
  protected _sessionDir?: string;
  protected _tools?: ToolDefinition[];
  protected _skills: SkillDefinition[] = [];
  protected _maxTurns?: number;
  protected _sdkTools?: unknown[];
  protected _contextDir?: string;
  protected _workspaceRoot?: string;
  protected _sandboxContext?: import('../tools/types').ToolExecutionContext;
  protected _lightweight = false;
  protected _providerConfig?: ProviderConfig;
  protected _providerModelId?: string;
  protected _agentId?: string;

  /** Agent 定义 ID（关联到 AgentStore 中的 Agent 定义） */
  agentId(id: string): this {
    this._agentId = id;
    return this;
  }

  /** 获取 Agent ID（供 AgentEnvInjector 读取） */
  getAgentId(): string | undefined {
    return this._agentId;
  }

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

  /**
   * 轻量模式（默认 false）
   *
   * 启用后，AgentExecutor.stream() 将跳过工作空间创建和事件广播。
   * 适用于临时、一次性的 LLM 调用。
   */
  lightweight(enabled: boolean): this {
    this._lightweight = enabled;
    return this;
  }

  /** 获取轻量模式标志（供 AgentExecutor 读取） */
  getLightweight(): boolean {
    return this._lightweight;
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

  /** 技能列表（累加模式，多次调用会合并，自动按 name 去重） */
  skills(skills: SkillDefinition[]): this {
    const existing = new Set(this._skills.map((s) => s.name));
    for (const s of skills) {
      if (!existing.has(s.name)) {
        this._skills.push(s);
        existing.add(s.name);
      }
    }
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

  /** 获取当前设置的工作区根目录 */
  getWorkspaceRoot(): string | undefined {
    return this._workspaceRoot;
  }

  /** 工具执行上下文（由 EnvInjector 自动设置） */
  sandboxContext(ctx: import('../tools/types').ToolExecutionContext): this {
    this._sandboxContext = ctx;
    return this;
  }

  /**
   * 从 ProviderConfig 设置模型参数
   *
   * 自动设置 apiKey、baseURL、model（从 ProviderConfig 中提取）。
   * 优先级高于 .env 环境变量。
   * PiMonoBuilder 使用此配置；OpenAIBuilder 继承但不使用。
   */
  fromProviderConfig(config: ProviderConfig, modelId?: string): this {
    this._providerConfig = config;
    this._providerModelId = modelId;
    return this;
  }

  /** 构建并初始化 Runtime（子类实现） */
  abstract build(defaultSessionDir?: string): Promise<AgentRuntime>;
}

/**
 * 获取默认 session 存储目录
 */
export function getDefaultSessionDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const env = require('@main/common/env') as { Env: { paths: { userData: string } } };
    return path.join(env.Env.paths.userData, 'sessions');
  } catch {
    const home = process.env.HOME || '/tmp';
    return path.join(home, '.coobee-ai', 'sessions');
  }
}
