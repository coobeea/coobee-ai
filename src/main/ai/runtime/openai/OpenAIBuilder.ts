/**
 * OpenAI Agent Builder
 *
 * 链式 API 构建 OpenAIAgentRuntime。
 * 通过 agentExecutor.openai() 获取。
 */

import type { AgentRuntime } from '../AgentRuntime';
import { BaseAgentBuilder, getDefaultSessionDir } from '../BaseAgentBuilder';
import type { SkillDefinition } from '../types';
import type { OpenAIAgentRuntimeOptions, SessionCompressionOptions } from './types';

export class OpenAIBuilder extends BaseAgentBuilder {
  private _handoffs?: unknown[];
  private _modelSettings?: Record<string, unknown>;
  private _compression?: SessionCompressionOptions;

  /** 技能列表（累加模式，多次调用会合并） */
  override skills(skills: SkillDefinition[]): this {
    this._skills.push(...skills);
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

  /** 构建并初始化 Runtime */
  override async build(defaultSessionDir?: string): Promise<AgentRuntime> {
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
