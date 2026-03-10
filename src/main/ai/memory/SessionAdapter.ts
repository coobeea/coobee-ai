/**
 * SDK Session 适配器
 *
 * 将项目的 SessionMemoryStore 包装为 SDK 兼容的 Session 接口
 * 使 run() 可以自动管理对话历史
 *
 * SDK Session 接口：
 * - getSessionId(): Promise<string>
 * - getItems(limit?: number): Promise<AgentInputItem[]>
 * - addItems(items: AgentInputItem[]): Promise<void>
 * - popItem(): Promise<AgentInputItem | undefined>
 * - clearSession(): Promise<void>
 */

import type { Session, AgentInputItem } from '@openai/agents';
import { createLogger } from '@main/common/logger';
import type { SessionMemoryStore } from './SessionMemoryStore';
import type { Message } from './types';

const log = createLogger('memory:session-adapter');

/**
 * 将项目 Message 转换为 SDK AgentInputItem
 */
function messageToInputItem(message: Message): AgentInputItem {
  // 映射到 OpenAI Responses API 消息格式
  // 使用 unknown 中转以兼容 SDK 的严格联合类型
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content
    } as unknown as AgentInputItem;
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: message.content }]
    } as unknown as AgentInputItem;
  }

  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content
    } as unknown as AgentInputItem;
  }

  // tool 消息 - 转为 user 消息
  return {
    role: 'user',
    content: `[Tool result] ${message.content}`
  } as unknown as AgentInputItem;
}

/**
 * 将 SDK AgentInputItem 转换为项目 Message
 */
function inputItemToMessage(item: AgentInputItem): Message {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyItem = item as any;
  const role = (anyItem.role as string) || 'assistant';
  let content = '';

  if (typeof anyItem.content === 'string') {
    content = anyItem.content;
  } else if (Array.isArray(anyItem.content)) {
    // 从 content 数组提取文本
    content = (anyItem.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'output_text' || c.type === 'input_text')
      .map((c) => c.text || '')
      .join('');
  }

  // 映射角色
  let mappedRole: Message['role'] = 'assistant';
  if (role === 'user') mappedRole = 'user';
  else if (role === 'developer' || role === 'system') mappedRole = 'system';
  else if (role === 'tool') mappedRole = 'tool';

  return {
    role: mappedRole,
    content,
    timestamp: Date.now()
  };
}

/**
 * SDK Session 适配器
 *
 * 将 SessionMemoryStore 包装为 SDK 兼容的 Session 接口
 * 这样 run() 可以自动管理对话历史（读取历史 + 追加新消息）
 */
export class SessionAdapter implements Session {
  constructor(
    private store: SessionMemoryStore,
    private sessionId: string
  ) {}

  /**
   * 返回会话 ID
   */
  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  /**
   * 获取对话历史
   * SDK 在每次 run() 前调用此方法获取上下文
   */
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const messages = await this.store.getHistory(limit);
    return messages.map(messageToInputItem);
  }

  /**
   * 追加新的对话项
   * SDK 在每次 run() 后调用此方法保存新消息
   */
  async addItems(items: AgentInputItem[]): Promise<void> {
    const messages = items.map(inputItemToMessage);
    await this.store.appendMessages(messages);
  }

  /**
   * 弹出最后一条消息
   */
  async popItem(): Promise<AgentInputItem | undefined> {
    // SessionMemoryStore 目前不支持 pop 操作
    // 返回 undefined 表示无法弹出
    log.warn('popItem not fully supported, returning undefined');
    return undefined;
  }

  /**
   * 清空会话
   */
  async clearSession(): Promise<void> {
    await this.store.clearHistory();
  }
}

/**
 * 创建 SDK Session 适配器
 */
export function createSessionAdapter(store: SessionMemoryStore, sessionId: string): Session {
  return new SessionAdapter(store, sessionId);
}
