/**
 * LLMService — 统一的内部 LLM 调用服务
 *
 * 所有辅助 LLM 调用（质量闭环、cron 解析、记忆提取等）通过此服务发起，
 * 内部走 AgentExecutor.piMono().lightweight(true) 链路，
 * 天然继承 ProviderRegistry 的 API Key / baseURL / model 配置。
 *
 * 替代旧的 LLMClient，消除绕过主 Runtime 体系的独立 OpenAI 客户端。
 */

import { createLogger } from '@main/common/logger';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const log = createLogger('LLMService');

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

/* eslint-disable @typescript-eslint/no-explicit-any */

export class LLMService {
  constructor(private agentExecutor: any) {}

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const systemMsg = options.messages.find((m) => m.role === 'system');
    const userMessages = options.messages.filter((m) => m.role !== 'system');
    const userContent = userMessages.map((m) => m.content).join('\n');

    if (!userContent.trim()) {
      return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }

    const sessionId = `llm-svc-${generateSnowflakeId()}`;

    const builder = this.agentExecutor
      .piMono()
      .lightweight(true)
      .mode('chat')
      .name('llm-service')
      .sessionMode('memory')
      .maxTurns(1);

    if (systemMsg?.content) {
      builder.instructions(systemMsg.content);
    }

    let output = '';
    try {
      const gen = this.agentExecutor.stream({
        sessionId,
        message: userContent,
        builder
      });

      for await (const chunk of gen) {
        if (chunk.type === 'text:delta' && chunk.content) {
          output += chunk.content;
        }
      }
    } catch (error) {
      log.error(`[LLMService] chat failed: sessionId=${sessionId}`, error);
      throw error;
    }

    return {
      content: output,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    };
  }
}
