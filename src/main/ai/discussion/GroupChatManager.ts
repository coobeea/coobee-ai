/**
 * GroupChatManager — 普通群聊管理器
 *
 * 与 DiscussionCoordinator 的区别：
 *   - 用户驱动（用户发消息触发 Agent 回复），而非系统自动轮转
 *   - 无共识度检测，无自动结束
 *   - 通过 @mention 指定回复的 Agent
 *   - 同一时间只有一个 Agent 在回复（串行执行）
 */

import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { Env } from '@main/common/env';
import { DiscussionStore } from './DiscussionStore';
import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import type { DiscussionSession, DiscussionParticipant, DiscussionMessage } from './types';

const log = createLogger('group-chat');

export interface CreateGroupChatParams {
  topic: string;
  participants: DiscussionParticipant[];
}

export class GroupChatManager {
  private static activeSessions = new Map<string, boolean>();

  private static async getStore(): Promise<DiscussionStore> {
    const storePath = `${Env.paths.userHome}/discussions`;
    return DiscussionStore.getInstance(storePath);
  }

  /**
   * 创建群聊会话
   */
  static async create(params: CreateGroupChatParams): Promise<DiscussionSession> {
    const store = await this.getStore();
    const now = Date.now();

    const session = await store.create({
      topic: params.topic,
      participants: params.participants.map((p) => ({ ...p, active: true })),
      messages: [],
      status: 'active',
      turnStrategy: 'group-chat',
      createdAt: now,
      updatedAt: now
    });

    log.info(`[GroupChat] Created: ${session.id} "${params.topic}" (${params.participants.length} participants)`);
    return session;
  }

  /**
   * 列出群聊会话（仅 group-chat 策略）
   */
  static async list(): Promise<DiscussionSession[]> {
    const store = await this.getStore();
    const all = await store.list();
    return all.filter((s) => s.turnStrategy === 'group-chat');
  }

  /**
   * 获取群聊会话
   */
  static async get(sessionId: string): Promise<DiscussionSession | null> {
    const store = await this.getStore();
    return store.get(sessionId);
  }

  /**
   * 用户发送消息
   *
   * 流程：
   * 1. 解析 @mentions
   * 2. 存储用户消息
   * 3. 串行执行每个被 @mention 的 Agent
   * 4. 每个 Agent 回复后推送实时事件
   */
  static async sendUserMessage(sessionId: string, content: string): Promise<void> {
    const store = await this.getStore();
    const session = await store.get(sessionId);
    if (!session) throw new Error(`群聊会话 ${sessionId} 不存在`);
    if (session.status !== 'active') throw new Error(`群聊会话 ${sessionId} 不在活跃状态`);

    const mentions = this.parseMentions(content, session.participants);

    const userMsg: DiscussionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: '__user__',
      content,
      timestamp: Date.now(),
      type: 'user',
      mentions: mentions.map((p) => p.agentId)
    };

    session.messages.push(userMsg);
    session.updatedAt = Date.now();
    await store.save(session);

    eventBus.emit('groupchat:message', { sessionId, message: userMsg });

    if (mentions.length === 0) {
      log.debug(`[GroupChat] No @mentions in message, skipping agent execution`);
      return;
    }

    if (this.activeSessions.get(sessionId)) {
      log.warn(`[GroupChat] Session ${sessionId} already processing, queuing skipped`);
      return;
    }

    this.activeSessions.set(sessionId, true);
    try {
      for (const participant of mentions) {
        await this.executeAgentReply(sessionId, session, participant, content);
      }
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * 结束群聊
   */
  static async end(sessionId: string): Promise<DiscussionSession> {
    const store = await this.getStore();
    const session = await store.get(sessionId);
    if (!session) throw new Error(`群聊会话 ${sessionId} 不存在`);

    session.status = 'completed';
    session.updatedAt = Date.now();
    await store.save(session);

    eventBus.emit('groupchat:ended', { sessionId });
    log.info(`[GroupChat] Ended: ${sessionId} (${session.messages.length} messages)`);
    return session;
  }

  /**
   * 删除群聊
   */
  static async delete(sessionId: string): Promise<void> {
    const store = await this.getStore();
    await store.delete(sessionId);
  }

  /**
   * 解析消息中的 @mentions
   *
   * 支持 @agentName 和 @agentId 两种格式
   */
  private static parseMentions(content: string, participants: DiscussionParticipant[]): DiscussionParticipant[] {
    const mentionPattern = /@([\w\u4e00-\u9fff-]+)/g;
    const matched = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = mentionPattern.exec(content)) !== null) {
      const token = m[1];
      for (const p of participants) {
        if (p.agentId === token || p.name === token) {
          matched.add(p.agentId);
          break;
        }
      }
    }

    return participants.filter((p) => matched.has(p.agentId));
  }

  /**
   * 执行单个 Agent 回复
   */
  private static async executeAgentReply(
    sessionId: string,
    session: DiscussionSession,
    participant: DiscussionParticipant,
    userMessage: string
  ): Promise<void> {
    const subSessionId = `${sessionId}-${participant.agentId}`;
    const historyContext = this.buildHistoryContext(session, 20);

    log.info(`[GroupChat] Executing agent ${participant.agentId} for session ${sessionId}`);

    eventBus.emit('groupchat:typing', {
      sessionId,
      agentId: participant.agentId,
      typing: true
    });

    try {
      const runtime = ChannelRuntime.getInstance();
      const result = await runtime.executeAgent({
        agentId: participant.agentId,
        sessionId: subSessionId,
        message: userMessage,
        context: {
          channel: 'group-chat',
          roomId: sessionId,
          topic: session.topic,
          role: participant.role || participant.name,
          discussionHistory: historyContext
        }
      });

      if (result.error) {
        log.error(`[GroupChat] Agent ${participant.agentId} error:`, result.error);
        return;
      }

      const agentMsg: DiscussionMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: participant.agentId,
        content: result.output,
        timestamp: Date.now(),
        type: 'answer'
      };

      const store = await this.getStore();
      const latestSession = await store.get(sessionId);
      if (latestSession) {
        latestSession.messages.push(agentMsg);
        latestSession.updatedAt = Date.now();
        await store.save(latestSession);
      }

      eventBus.emit('groupchat:message', { sessionId, message: agentMsg });
    } finally {
      eventBus.emit('groupchat:typing', {
        sessionId,
        agentId: participant.agentId,
        typing: false
      });
    }
  }

  /**
   * 构建聊天历史上下文（最近 N 条消息）
   */
  private static buildHistoryContext(session: DiscussionSession, maxMessages: number): string {
    const recent = session.messages.slice(-maxMessages);
    if (recent.length === 0) return '（暂无历史消息）';

    const getName = (agentId: string): string => {
      if (agentId === '__user__') return '用户';
      return session.participants.find((p) => p.agentId === agentId)?.name || agentId;
    };

    return recent.map((m) => `[${getName(m.agentId)}]: ${m.content}`).join('\n');
  }
}
