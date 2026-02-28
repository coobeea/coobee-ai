/**
 * 短期记忆 / 上下文窗口管理
 * 自己维护消息历史，解决 Session.messages 私有问题
 */

import { createLogger } from '@main/common/logger';
import type OpenAI from 'openai';
import type { Message } from './types';

const log = createLogger('ShortTermMemory');

/**
 * Trimming 策略的短期记忆
 * 保留最近 N 轮对话
 */
export class TrimmingSession {
  private messages: Message[] = [];
  private maxTurns: number;
  private systemMessages: Message[] = [];

  constructor(
    _client: OpenAI,
    options: {
      maxTurns?: number;
    } = {}
  ) {
    this.maxTurns = options.maxTurns || 10;
  }

  /**
   * 添加系统消息
   */
  async addSystemMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'system',
      content,
      timestamp: Date.now()
    };
    this.systemMessages.push(msg);
    this.messages.push(msg);
  }

  /**
   * 添加用户消息（自动触发修剪）
   */
  async addUserMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'user',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    await this.trimHistory();
  }

  /**
   * 添加助手消息
   */
  async addAssistantMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'assistant',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    await this.trimHistory();
  }

  /**
   * 添加工具消息
   */
  async addToolMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'tool',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
  }

  /**
   * 获取当前所有消息
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取消息用于创建 Session（供外部使用）
   * 注意：由于 Session 是接口，不能直接实例化
   * 实际使用时需要通过 @openai/agents 的 run() 函数
   */
  async getMessagesForSession(): Promise<Message[]> {
    return this.getMessages();
  }

  /**
   * 修剪历史消息，保留最近 N 轮
   */
  private async trimHistory(): Promise<void> {
    // 计算需要保留的消息数量：系统消息 + 最近的 N 轮对话
    const maxMessages = this.systemMessages.length + this.maxTurns * 2;

    if (this.messages.length > maxMessages) {
      // 分离系统消息和对话消息
      const conversationMessages = this.messages.filter((m) => m.role !== 'system');

      // 保留最近的 N 轮对话（user + assistant）
      const trimmedConversation = conversationMessages.slice(-this.maxTurns * 2);

      // 重建消息列表
      this.messages = [...this.systemMessages, ...trimmedConversation];

      log.info(`Trimmed history: kept ${this.messages.length} messages (${this.maxTurns} turns)`);
    }
  }

  /**
   * 清空消息历史（保留系统消息）
   */
  async clearHistory(): Promise<void> {
    this.messages = [...this.systemMessages];
  }

  /**
   * 完全清空（包括系统消息）
   */
  async reset(): Promise<void> {
    this.messages = [];
    this.systemMessages = [];
  }
}

/**
 * Summarization 策略的短期记忆
 * 将旧对话压缩为摘要
 */
export class SummarizingSession {
  private client: OpenAI;
  private messages: Message[] = [];
  private summaryThreshold: number;
  private hasSummary = false;
  private systemMessages: Message[] = [];
  private summaryModel: string;

  constructor(
    client: OpenAI,
    options: {
      summaryThreshold?: number;
      summaryModel?: string;
    } = {}
  ) {
    this.client = client;
    this.summaryThreshold = options.summaryThreshold || 20;
    this.summaryModel = options.summaryModel || 'gpt-4o-mini';
  }

  /**
   * 添加系统消息
   */
  async addSystemMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'system',
      content,
      timestamp: Date.now()
    };
    this.systemMessages.push(msg);
    this.messages.push(msg);
  }

  /**
   * 添加用户消息（自动触发总结）
   */
  async addUserMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'user',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    await this.summarizeHistory();
  }

  /**
   * 添加助手消息
   */
  async addAssistantMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'assistant',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    await this.summarizeHistory();
  }

  /**
   * 添加工具消息
   */
  async addToolMessage(content: string): Promise<void> {
    const msg: Message = {
      role: 'tool',
      content,
      timestamp: Date.now()
    };
    this.messages.push(msg);
  }

  /**
   * 获取当前所有消息
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取消息用于创建 Session（供外部使用）
   * 注意：由于 Session 是接口，不能直接实例化
   * 实际使用时需要通过 @openai/agents 的 run() 函数
   */
  async getMessagesForSession(): Promise<Message[]> {
    return this.getMessages();
  }

  /**
   * 总结旧对话并替换为摘要
   */
  private async summarizeHistory(): Promise<void> {
    const conversationMessages = this.messages.filter((m) => m.role !== 'system');

    // 检查是否需要总结
    if (conversationMessages.length <= this.summaryThreshold || this.hasSummary) {
      return;
    }

    // 保留最近 20 条消息，总结之前的部分
    const recentMessages = conversationMessages.slice(-20);
    const oldMessages = conversationMessages.slice(0, -20);

    if (oldMessages.length === 0) {
      return;
    }

    try {
      // 调用 LLM 生成摘要
      const summaryPrompt = `请总结以下对话历史的要点：\n\n${oldMessages.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\n请用简洁的语言（200-300字）总结关键信息和上下文。`;

      const summaryResponse = await this.client.chat.completions.create({
        model: this.summaryModel,
        messages: [
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
        temperature: 0.3
      });

      const summary = summaryResponse.choices[0]?.message?.content || '（总结失败）';

      // 创建摘要消息
      const summaryMsg: Message = {
        role: 'system',
        content: `[会话历史摘要]\n${summary}\n\n[以下是最近的对话]`,
        timestamp: Date.now()
      };

      // 重建消息列表：原系统消息 + 摘要 + 最近的消息
      this.messages = [...this.systemMessages, summaryMsg, ...recentMessages];
      this.hasSummary = true;

      log.info(`Summarized ${oldMessages.length} messages, kept ${recentMessages.length} recent messages`);
    } catch (error) {
      log.error('Failed to summarize history:', error);
      // 失败时不修改消息列表
    }
  }

  /**
   * 清空消息历史（保留系统消息）
   */
  async clearHistory(): Promise<void> {
    this.messages = [...this.systemMessages];
    this.hasSummary = false;
  }

  /**
   * 完全清空（包括系统消息）
   */
  async reset(): Promise<void> {
    this.messages = [];
    this.systemMessages = [];
    this.hasSummary = false;
  }
}
