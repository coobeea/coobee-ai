/**
 * PiMono Agent Builder
 *
 * 链式 API 构建 PiMonoAgentRuntime。
 * 通过 agentExecutor.piMono() 获取。
 */

import type { AgentRuntime } from '../AgentRuntime';
import { BaseAgentBuilder, getDefaultSessionDir } from '../BaseAgentBuilder';
import type { PiMonoAgentRuntimeOptions, ThinkingLevel } from './types';

export class PiMonoBuilder extends BaseAgentBuilder {
  private _apiKey?: string;
  private _baseURL?: string;
  private _sessionMode?: 'memory' | 'file';
  private _thinkingLevel?: ThinkingLevel;
  private _compaction?: { enabled?: boolean };
  private _retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };

  /** 获取已解析的模型引用（"provider/model" 格式，供故障转移重试使用） */
  getResolvedModelRef(): string | undefined {
    const modelId = this._providerModelId || this._model;
    if (!modelId || !this._providerConfig) return undefined;
    return `${this._providerConfig.id}/${modelId}`;
  }

  /** API Key（默认从 VITE_LLM_API_KEY 读取） */
  apiKey(key: string): this {
    this._apiKey = key;
    return this;
  }

  /** API Base URL（默认从 VITE_LLM_BASE_URL 读取） */
  baseURL(url: string): this {
    this._baseURL = url;
    return this;
  }

  /** 会话持久化模式（默认 memory） */
  sessionMode(mode: 'memory' | 'file'): this {
    this._sessionMode = mode;
    return this;
  }

  /** 工作目录（与 OpenAIBuilder.workspaceRoot() 对齐） */
  cwd(dir: string): this {
    this._workspaceRoot = dir;
    return this;
  }

  /** 工作区根目录（cwd 的别名，统一 Builder API） */
  override workspaceRoot(dir: string): this {
    this._workspaceRoot = dir;
    return this;
  }

  /** 思考级别 */
  thinkingLevel(level: ThinkingLevel): this {
    this._thinkingLevel = level;
    return this;
  }

  /** 压缩配置 */
  compaction(config: { enabled?: boolean }): this {
    this._compaction = config;
    return this;
  }

  /** 重试配置 */
  retry(config: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }): this {
    this._retry = config;
    return this;
  }

  /** 构建并初始化 Runtime（内部方法，由 Executor 调用） */
  override async build(defaultSessionDir?: string): Promise<AgentRuntime> {
    // 解析 API Key: providerConfig > 显式设置 > 环境变量
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error(
        'API Key 未配置：请在 coobee.json5 中配置 models.providers 或通过 DASHSCOPE_API_KEY 等环境变量设置'
      );
    }

    const opts: PiMonoAgentRuntimeOptions = {
      name: this._name,
      instructions: this._instructions,
      apiKey,
      model: this.resolveModel(),
      baseURL: this.resolveBaseURL()
    };

    // 可选字段：仅在设置时传入，避免覆盖 Runtime 的默认值
    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions;
    if (this._sessionId) opts.sessionId = this._sessionId;
    if (this._sessionMode) opts.sessionMode = this._sessionMode;
    // sessionDir: 显式传入 > 默认值
    opts.sessionDir = this._sessionDir || defaultSessionDir || getDefaultSessionDir();
    if (this._tools) opts.tools = this._tools;
    if (this._skills.length) opts.skills = this._skills;
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns;
    if (this._workspaceRoot) {
      opts.cwd = this._workspaceRoot;
      opts.workspaceRoot = this._workspaceRoot;
    }
    if (this._thinkingLevel) opts.thinkingLevel = this._thinkingLevel;
    // 从 ProviderConfig 提取模型元数据，透传给 Runtime 用于构造 pi-SDK Model 对象
    opts.modelMeta = this.resolveModelMeta();
    if (this._sdkTools) opts.sdkTools = this._sdkTools;
    if (this._compaction) opts.compaction = this._compaction;
    if (this._retry) opts.retry = this._retry;
    if (this._contextDir) opts.contextDir = this._contextDir;
    if (this._sandboxContext) opts.sandboxContext = this._sandboxContext;

    // 动态导入，避免顶层加载 SDK
    const { PiMonoAgentRuntime } = await import('./index');
    const runtime = new PiMonoAgentRuntime(opts);
    await runtime.initialize();

    return runtime;
  }

  // ─── 解析辅助方法（ProviderConfig > 显式设置 > 环境变量） ───

  private resolveApiKey(): string | undefined {
    // 优先级: 显式设置 > ProviderConfig > 环境变量兜底
    if (this._apiKey) return this._apiKey;
    if (this._providerConfig?.apiKey) {
      const key = this._providerConfig.apiKey;
      const match = key.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)}$/);
      if (match) {
        return process.env[match[1]] || key;
      }
      return key;
    }
    // 兜底：检查常见 API key 环境变量
    return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || process.env.VITE_LLM_API_KEY;
  }

  private resolveModel(): string {
    if (this._model) return this._model;
    if (this._providerConfig && this._providerModelId) return this._providerModelId;
    if (this._providerConfig?.models?.[0]) return this._providerConfig.models[0].id;
    return process.env.VITE_LLM_MODEL || 'qwen3-max';
  }

  private resolveBaseURL(): string {
    if (this._baseURL) return this._baseURL;
    if (this._providerConfig?.baseUrl) return this._providerConfig.baseUrl;
    return process.env.VITE_LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  /**
   * 从 ProviderConfig 提取模型元数据
   *
   * 查找匹配的 ModelConfig，提取 reasoning/contextWindow/maxOutputTokens 等字段，
   * 用于动态构造 pi-SDK Model 对象（替代硬编码默认值）。
   */
  private resolveModelMeta(): PiMonoAgentRuntimeOptions['modelMeta'] {
    if (!this._providerConfig) return undefined;

    const modelId = this._providerModelId || this._model;
    if (!modelId) return undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelCfg = this._providerConfig.models?.find((m: any) => m.id === modelId) as
      | Record<string, unknown>
      | undefined;
    if (!modelCfg) return undefined;

    return {
      reasoning: (modelCfg.reasoning as boolean) ?? undefined,
      contextWindow: (modelCfg.contextWindow as number) ?? undefined,
      maxOutputTokens: (modelCfg.maxOutputTokens as number) ?? undefined,
      maxThinkingTokens: (modelCfg.maxThinkingTokens as number) ?? undefined,
      functionCalling: (modelCfg.functionCalling as boolean) ?? undefined
    };
  }
}
