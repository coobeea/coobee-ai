/**
 * MessageBus - Agent 间消息总线
 *
 * 提供 Agent 间的异步通信机制：
 * - 点对点消息：指定发送给某个角色
 * - 广播消息：发送给所有 Agent
 * - 话题过滤：getMessagesByTopic 按话题查询
 * - 消息历史：查询历史消息
 * - 消息队列：未读消息自动累积
 */

import { createLogger } from '@main/common/logger';

const log = createLogger('MessageBus');

/** 消息历史最大条数，防止内存泄漏 */
const MAX_MESSAGES = 1000;

// ========== 类型定义 ==========

/**
 * 消息优先级
 */
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 消息
 */
export interface SwarmMessage {
  /** 消息 ID */
  id: string;
  /** 发送者角色 ID */
  fromRoleId: string;
  /** 接收者角色 ID（'*' 表示广播） */
  toRoleId: string;
  /** 话题标签 */
  topic?: string;
  /** 消息内容 */
  content: string;
  /** 优先级 */
  priority: MessagePriority;
  /** 发送时间 */
  timestamp: number;
  /** 是否已读 */
  read: boolean;
  /** 附带的数据 */
  data?: unknown;
}

/**
 * 消息总线事件
 */
export interface MessageBusEvent {
  type: 'message_sent' | 'message_read';
  message?: SwarmMessage;
  roleId?: string;
  topic?: string;
  timestamp: number;
}

export type MessageBusEventListener = (event: MessageBusEvent) => void;

/**
 * Agent 间消息总线
 */
export class MessageBus {
  /** 所有消息历史 */
  private messages: SwarmMessage[] = [];

  /** 消息 ID 计数器 */
  private messageCounter = 0;

  /** 事件监听器 */
  private eventListeners: MessageBusEventListener[] = [];

  // ========== 发送消息 ==========

  /**
   * 发送点对点消息
   * @param fromRoleId 发送者角色 ID
   * @param toRoleId 接收者角色 ID
   * @param content 消息内容
   * @param options 可选配置
   */
  send(
    fromRoleId: string,
    toRoleId: string,
    content: string,
    options?: { topic?: string; priority?: MessagePriority; data?: unknown }
  ): SwarmMessage {
    const message = this.createMessage(fromRoleId, toRoleId, content, options);
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }

    this.emitEvent({
      type: 'message_sent',
      message,
      timestamp: Date.now()
    });

    log.info(`${fromRoleId} -> ${toRoleId}: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`);

    return message;
  }

  /**
   * 广播消息给所有 Agent
   */
  broadcast(
    fromRoleId: string,
    content: string,
    options?: { topic?: string; priority?: MessagePriority; data?: unknown }
  ): SwarmMessage {
    return this.send(fromRoleId, '*', content, options);
  }

  /**
   * 发送请求消息（期望对方回复）
   */
  request(fromRoleId: string, toRoleId: string, content: string, topic?: string): SwarmMessage {
    return this.send(fromRoleId, toRoleId, content, {
      topic: topic || `request-${this.messageCounter}`,
      priority: 'high'
    });
  }

  // ========== 接收消息 ==========

  /**
   * 获取发给指定角色的未读消息
   */
  getUnreadMessages(roleId: string): SwarmMessage[] {
    return this.messages.filter(
      (m) => !m.read && (m.toRoleId === roleId || m.toRoleId === '*') && m.fromRoleId !== roleId
    );
  }

  /**
   * 获取发给指定角色的所有消息
   */
  getMessagesForRole(roleId: string, limit?: number): SwarmMessage[] {
    const filtered = this.messages.filter(
      (m) => (m.toRoleId === roleId || m.toRoleId === '*') && m.fromRoleId !== roleId
    );

    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * 获取指定话题的消息
   */
  getMessagesByTopic(topic: string, limit?: number): SwarmMessage[] {
    const filtered = this.messages.filter((m) => m.topic === topic);
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * 获取两个角色之间的消息（对话）
   */
  getConversation(roleA: string, roleB: string, limit?: number): SwarmMessage[] {
    const filtered = this.messages.filter(
      (m) => (m.fromRoleId === roleA && m.toRoleId === roleB) || (m.fromRoleId === roleB && m.toRoleId === roleA)
    );
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * 将消息标记为已读
   */
  markAsRead(messageId: string): void {
    const message = this.messages.find((m) => m.id === messageId);
    if (message) {
      message.read = true;
      this.emitEvent({
        type: 'message_read',
        message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 批量标记为已读
   */
  markAllAsRead(roleId: string): void {
    for (const message of this.messages) {
      if (!message.read && (message.toRoleId === roleId || message.toRoleId === '*') && message.fromRoleId !== roleId) {
        message.read = true;
      }
    }
  }

  // ========== 格式化（用于注入 Agent 指令） ==========

  /**
   * 将未读消息格式化为可读文本（注入到 Agent prompt 中）
   */
  formatUnreadForAgent(roleId: string): string {
    const unread = this.getUnreadMessages(roleId);
    if (unread.length === 0) {
      return '';
    }

    const parts = [`\n## 收到的消息 (${unread.length} 条未读)\n`];
    for (const msg of unread) {
      const priority = msg.priority === 'urgent' ? ' [紧急]' : msg.priority === 'high' ? ' [重要]' : '';
      const topic = msg.topic ? ` (话题: ${msg.topic})` : '';
      parts.push(`- **来自 ${msg.fromRoleId}**${priority}${topic}: ${msg.content}`);
    }

    return parts.join('\n');
  }

  /**
   * 将消息历史格式化为对话文本
   */
  formatConversation(roleA: string, roleB: string, limit: number = 10): string {
    const conversation = this.getConversation(roleA, roleB, limit);
    if (conversation.length === 0) {
      return '';
    }

    const parts = [`\n## ${roleA} 与 ${roleB} 的对话历史\n`];
    for (const msg of conversation) {
      parts.push(`**${msg.fromRoleId}**: ${msg.content}`);
    }

    return parts.join('\n');
  }

  // ========== 统计 ==========

  /**
   * 获取消息统计
   */
  getStats(): {
    totalMessages: number;
    unreadCount: number;
    topicCount: number;
    messagesByRole: Record<string, number>;
    messagesByTopic: Record<string, number>;
  } {
    const messagesByRole: Record<string, number> = {};
    const messagesByTopic: Record<string, number> = {};
    let unreadCount = 0;

    for (const msg of this.messages) {
      messagesByRole[msg.fromRoleId] = (messagesByRole[msg.fromRoleId] || 0) + 1;
      if (msg.topic) {
        messagesByTopic[msg.topic] = (messagesByTopic[msg.topic] || 0) + 1;
      }
      if (!msg.read) {
        unreadCount++;
      }
    }

    return {
      totalMessages: this.messages.length,
      unreadCount,
      topicCount: Object.keys(messagesByTopic).length,
      messagesByRole,
      messagesByTopic
    };
  }

  // ========== 内部方法 ==========

  /**
   * 将消息推入历史（不触发通知）
   * 供子类恢复持久化消息时使用
   */
  protected pushMessage(msg: SwarmMessage): void {
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }
  }

  /** 获取当前消息 ID 计数器 */
  protected getMessageCounter(): number {
    return this.messageCounter;
  }

  /** 设置消息 ID 计数器（恢复时同步） */
  protected setMessageCounter(value: number): void {
    this.messageCounter = value;
  }

  private createMessage(
    fromRoleId: string,
    toRoleId: string,
    content: string,
    options?: { topic?: string; priority?: MessagePriority; data?: unknown }
  ): SwarmMessage {
    this.messageCounter++;
    return {
      id: `msg-${this.messageCounter}`,
      fromRoleId,
      toRoleId,
      topic: options?.topic,
      content,
      priority: options?.priority || 'normal',
      timestamp: Date.now(),
      read: false,
      data: options?.data
    };
  }

  // ========== 事件系统 ==========

  addEventListener(listener: MessageBusEventListener): void {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener: MessageBusEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emitEvent(event: MessageBusEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('Event listener error:', error);
      }
    }
  }

  // ========== 清理 ==========

  /**
   * 清空所有消息
   */
  clear(): void {
    this.messages = [];
    this.messageCounter = 0;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.clear();
    this.eventListeners = [];
  }
}
