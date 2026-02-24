/**
 * LLMClient - 简化的 LLM 客户端接口
 *
 * 用于质量闭环系统，提供统一的 LLM 调用接口
 */

import OpenAI from 'openai';

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
 * 简化的 LLM 客户端
 * 目前仅支持 OpenAI API
 */
export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(options: LLMClientOptions) {
    this.model = options.model || 'gpt-4o-mini';

    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      baseURL: options.baseURL
    });
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
