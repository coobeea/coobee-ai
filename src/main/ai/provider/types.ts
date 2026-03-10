/**
 * 模型 Provider 体系类型定义
 */

/** 支持的 API 格式 */
export type ModelApi = 'openai-compatible' | 'anthropic' | 'google';

/** Provider 配置 */
export interface ProviderConfig {
  /** Provider 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 基础 URL */
  baseUrl: string;
  /** API Key（可含 ${ENV_VAR} 模板） */
  apiKey?: string;
  /** API 格式 */
  api: ModelApi;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 模型列表 */
  models: ModelConfig[];
  /** 是否启用 */
  enabled: boolean;
}

/** 模型配置 */
export interface ModelConfig {
  /** 模型 ID（如 gpt-4o、qwen3-max） */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 格式（可覆盖 Provider 级别） */
  api?: ModelApi;
  /** 是否支持推理模式 */
  reasoning?: boolean;
  /** 输入类型 */
  input?: ('text' | 'image')[];
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 成本配置 */
  cost?: ModelCostConfig;
}

/** 成本配置（$/百万 token） */
export interface ModelCostConfig {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** 模型引用（provider/model 格式的解析结果） */
export interface ModelRef {
  /** Provider ID */
  provider: string;
  /** 模型 ID */
  model: string;
}

/** 解析后的完整模型信息（Provider + Model 合并） */
export interface ResolvedModel {
  ref: ModelRef;
  provider: ProviderConfig;
  model: ModelConfig;
  /** 实际使用的 API 格式（model 级别 > provider 级别） */
  api: ModelApi;
  /** 实际使用的 API Key（解析后） */
  resolvedApiKey?: string;
}

/** 模型选择配置 */
export interface ModelSelectionConfig {
  /** 主模型（"provider/model" 格式） */
  primary: string;
  /** 备选模型列表 */
  fallbacks?: string[];
}

/** Fallback 执行结果 */
export interface FallbackResult<T> {
  result: T;
  provider: string;
  model: string;
  attempts: number;
  failedModels: string[];
}

/**
 * 解析 "provider/model" 格式字符串为 ModelRef
 */
export function parseModelRef(ref: string): ModelRef {
  const slashIndex = ref.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`Invalid model ref "${ref}": expected "provider/model" format`);
  }
  return {
    provider: ref.slice(0, slashIndex),
    model: ref.slice(slashIndex + 1)
  };
}

/**
 * 将 ModelRef 序列化为 "provider/model" 格式
 */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}
