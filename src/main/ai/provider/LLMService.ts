/**
 * LLMService — 统一的内部 LLM 调用服务（单例）
 *
 * 所有辅助 LLM 调用（质量闭环、cron 解析、记忆提取等）通过此服务发起，
 * 内部走 AgentExecutor.piMono().lightweight(true) 链路，
 * 天然继承 ProviderRegistry 的 API Key / baseURL / model 配置。
 *
 * 用法：
 *   import { getLLMService } from '@main/ai/provider/LLMService';
 *   const result = await getLLMService().chat({ messages: [...] });
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
  /**
   * 温度参数（0-1）
   *
   * 注意：当前 PiMono 后端不支持 per-request temperature，
   * 此参数仅在 prompt 中以自然语言方式暗示（如 "请精确回答"）。
   * 未来切换到 OpenAI runtime 后可通过 modelSettings 传递。
   */
  temperature?: number;
  /** 最大输出 token 数（同上，PiMono 后端暂不支持 per-request 设置） */
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

// ==================== 单例 ====================

let _instance: LLMService | null = null;
let _agentExecutorRef: any = null;

/**
 * 注入 AgentExecutor 引用（在 ReadyInfraHook 或启动时调用一次）。
 * 也可以不调用——getLLMService 会延迟自动获取。
 */
export function initLLMService(agentExecutor: any): void {
  _agentExecutorRef = agentExecutor;
  _instance = null;
}

/**
 * 获取 LLMService 全局单例。
 * 优先使用 initLLMService 注入的引用，否则延迟导入 AgentExecutor 单例。
 */
export function getLLMService(): LLMService {
  if (!_instance) {
    if (!_agentExecutorRef) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _agentExecutorRef = require('../AgentExecutor').agentExecutor;
    }
    _instance = new LLMService(_agentExecutorRef);
  }
  return _instance;
}

/** 用于测试：重置单例 */
export function resetLLMService(): void {
  _instance = null;
  _agentExecutorRef = null;
}
