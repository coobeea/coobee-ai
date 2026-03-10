/**
 * llm-chat.ts — 轻量 LLM 对话工具函数
 *
 * 将 AgentExecutor.stream() 封装为"发一段话 → 拿回一段话"的便捷调用。
 * 用于质量闭环（Validator/Repairer/Aggregator）、记忆提取等内部辅助场景。
 *
 * 设计原则：
 *   - 不新增任何 Service / 单例 / 中间层
 *   - 底层始终走 AgentExecutor → Runtime 正路
 *   - 调用者通过 createLLMChat(agentExecutor) 创建函数引用
 */

import { createLogger } from '@main/common/logger';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';

const log = createLogger('llm-chat');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * 最小 AgentExecutor 接口（避免循环依赖）
 *
 * 仅声明 createLLMChat 内部实际调用的路径。
 */
export interface AgentExecutorLike {
  stream(request: {
    sessionId: string;
    message: string;
    builder?: unknown;
  }): AsyncGenerator<{ type: string; content?: string }, unknown, unknown>;

  piMono(): PiMonoBuilder;
}

/**
 * piMono() 返回的 fluent builder 最小链路。
 * createLLMChat 内部只走 lightweight → mode → name → sessionMode → maxTurns → instructions。
 */
interface PiMonoBuilder {
  lightweight(v: boolean): PiMonoBuilder;
  mode(m: string): PiMonoBuilder;
  name(n: string): PiMonoBuilder;
  sessionMode(s: string): PiMonoBuilder;
  maxTurns(t: number): PiMonoBuilder;
  instructions(i: string): PiMonoBuilder;
  [key: string]: unknown;
}

/**
 * LLM 对话函数类型
 *
 * Validator / Repairer / Aggregator 的构造函数接受此类型。
 */
export type LLMChatFn = (options: ChatOptions) => Promise<string>;

/**
 * 从 AgentExecutor 创建 LLMChatFn
 *
 * 内部走 piMono().lightweight(true).mode('chat') 链路，
 * 天然继承 ProviderRegistry 的 API Key / baseURL / model 配置。
 */
export function createLLMChat(agentExecutor: AgentExecutorLike): LLMChatFn {
  return async (options: ChatOptions): Promise<string> => {
    const systemMsg = options.messages.find((m) => m.role === 'system');
    const userMessages = options.messages.filter((m) => m.role !== 'system');
    const userContent = userMessages.map((m) => m.content).join('\n');

    if (!userContent.trim()) return '';

    const sessionId = `llm-chat-${generateSnowflakeId()}`;

    const builder = agentExecutor
      .piMono()
      .lightweight(true)
      .mode('chat')
      .name('llm-chat')
      .sessionMode('memory')
      .maxTurns(1);

    if (systemMsg?.content) {
      builder.instructions(systemMsg.content);
    }

    let output = '';
    try {
      const gen = agentExecutor.stream({ sessionId, message: userContent, builder });
      for await (const chunk of gen) {
        if (chunk.type === 'text:delta' && chunk.content) {
          output += chunk.content;
        }
      }
    } catch (error) {
      log.error(`[llm-chat] Failed: sessionId=${sessionId}`, error);
      throw error;
    }

    return output;
  };
}
