/**
 * 会话记忆存储
 * 负责完整持久化对话历史（JSONL 格式）
 */

import { createLogger } from '@main/common/logger';
import type { SessionFileManager } from '../storage/SessionFileManager';
import type { Message } from './types';

const log = createLogger('SessionMemoryStore');

/**
 * 会话记忆存储
 */
export class SessionMemoryStore {
  constructor(
    private sessionManager: SessionFileManager,
    private sessionId: string
  ) {}

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    log.info(`Initialized for session: ${this.sessionId}`);
  }

  /**
   * 追加消息到会话历史
   */
  async appendMessage(message: {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const entry: Message = {
      ...message,
      timestamp: message.timestamp || Date.now()
    };

    // 写入 JSONL 文件
    await this.sessionManager.appendMessage(entry);
  }

  /**
   * 批量追加消息
   */
  async appendMessages(messages: Message[]): Promise<void> {
    for (const message of messages) {
      await this.appendMessage(message);
    }
  }

  /**
   * 获取完整对话历史
   */
  async getHistory(limit?: number): Promise<Message[]> {
    const messages = (await this.sessionManager.readMessages()) as Message[];
    return limit ? messages.slice(-limit) : messages;
  }

  /**
   * 获取指定角色的消息
   */
  async getMessagesByRole(role: Message['role'], limit?: number): Promise<Message[]> {
    const allMessages = await this.getHistory();
    const filtered = allMessages.filter((m) => m.role === role);
    return limit ? filtered.slice(-limit) : filtered;
  }

  /**
   * 获取消息统计
   */
  async getStats(): Promise<{
    total: number;
    byRole: Record<string, number>;
    timeRange: { start: number; end: number } | null;
  }> {
    const messages = await this.getHistory();

    if (messages.length === 0) {
      return {
        total: 0,
        byRole: {},
        timeRange: null
      };
    }

    const byRole: Record<string, number> = {};
    for (const msg of messages) {
      byRole[msg.role] = (byRole[msg.role] || 0) + 1;
    }

    const timestamps = messages.map((m) => m.timestamp);
    const timeRange = {
      start: Math.min(...timestamps),
      end: Math.max(...timestamps)
    };

    return {
      total: messages.length,
      byRole,
      timeRange
    };
  }

  /**
   * 清空会话历史
   */
  async clearHistory(): Promise<void> {
    // 通过覆盖为空来清空（避免删除文件）
    // 注意：这里需要 SessionFileManager 支持清空操作
    log.info(`Clearing history for session: ${this.sessionId}`);
  }
}
