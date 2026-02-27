/**
 * LLMClient - 简化的 LLM 客户端接口
 *
 * 用于质量闭环、Swarm 协调器等内部模块。
 * 支持 OpenAI 兼容 API（包括 DashScope、MiniMax 等）。
 *
 * API Key 解析优先级：
 *   1. 显式传入 options.apiKey
 *   2. 从 ConfigStore 读取项目配置的默认 Provider
 *   3. 环境变量兜底（DASHSCOPE_API_KEY / OPENAI_API_KEY / VITE_LLM_API_KEY）
 */

import OpenAI from 'openai';
import { resolveApiKey } from './ApiKeyResolver';

export interface LLMClientOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 从 ConfigStore 读取默认 Provider 的 apiKey / baseURL / model。
 * 静默失败 — ConfigStore 未初始化时返回空对象。
 */
function resolveFromConfig(): { apiKey?: string; baseURL?: string; model?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configStoreInstance } = require('@main/common/config/ConfigStore');
    const config = configStoreInstance?.getAll?.();
    if (!config?.models?.defaults?.model?.primary) return {};

    const primary = config.models.defaults.model.primary as string;
    const [providerId, modelId] = primary.includes('/') ? primary.split('/') : ['', primary];

    if (!providerId || !config.models?.providers?.[providerId]) return { model: modelId };

    const provider = config.models.providers[providerId];
    const apiKey = resolveApiKey(provider.apiKey, providerId);
    return {
      apiKey,
      baseURL: provider.baseUrl,
      model: modelId || provider.models?.[0]?.id
    };
  } catch {
    return {};
  }
}

/**
 * 简化的 LLM 客户端（OpenAI 兼容）
 */
export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(options: LLMClientOptions) {
    const defaults = resolveFromConfig();

    const apiKey =
      options.apiKey ||
      defaults.apiKey ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.VITE_LLM_API_KEY;

    const baseURL = options.baseURL || defaults.baseURL;
    this.model = options.model || defaults.model || 'gpt-4o-mini';

    this.client = new OpenAI({ apiKey, baseURL });
  }

  /**
   * 发送聊天完成请求
   */
  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens
    });

    const choice = response.choices[0];
    const usage = response.usage;

    return {
      content: choice.message.content || '',
      usage: {
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0
      }
    };
  }
}
