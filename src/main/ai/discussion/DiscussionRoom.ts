/**
 * DiscussionRoom - 智能体讨论室
 *
 * 管理多个智能体进行结构化讨论，支持轮流发言、共识检测、讨论总结
 */

import { createLogger } from '@main/common/logger';
import { TurnManager } from './TurnManager';
import { ConsensusDetector } from './ConsensusDetector';
import { DiscussionStore } from './DiscussionStore';
import { ChannelManager } from '@main/channels/ChannelManager';
import type {
  DiscussionSession,
  DiscussionMessage,
  DiscussionParticipant,
  TurnStrategy,
  ConsensusResult
} from './types';

const log = createLogger('discussion-room');

export interface DiscussionOptions {
  /** 讨论主题 */
  topic: string;

  /** 参与者 */
  participants: DiscussionParticipant[];

  /** 发言策略 */
  turnStrategy?: TurnStrategy;

  /** 共识阈值（0-1，默认 0.7） */
  consensusThreshold?: number;

  /** 最大轮次（默认 20） */
  maxRounds?: number;
}

export class DiscussionRoom {
  private session!: DiscussionSession;
  private turnManager: TurnManager;
  private consensusDetector: ConsensusDetector;

  constructor(options: DiscussionOptions) {
    const now = Date.now();
    this.session = {
      id: `discussion-${now}-${Math.random().toString(36).slice(2, 8)}`,
      topic: options.topic,
      participants: options.participants,
      messages: [],
      status: 'active',
      createdAt: now,
      updatedAt: now
    };

    this.turnManager = new TurnManager(options.turnStrategy);
    this.turnManager.setParticipants(options.participants);

    this.consensusDetector = new ConsensusDetector();
  }

  /**
   * 开始讨论（触发第一个 Agent 发言）
   */
  async start(): Promise<void> {
    log.info(`[DiscussionRoom] Starting discussion: ${this.session.topic}`);

    const store = await DiscussionStore.getInstance();

    // 1. 保存 session 到数据库
    await store.save(this.session);

    // 2. 添加系统消息
    await store.addMessage(this.session.id, {
      participant: 'System',
      content: `Discussion started. Topic: ${this.session.topic}`,
      timestamp: Date.now(),
      type: 'statement'
    });

    // 3. 获取 Discussion Channel Plugin
    const manager = ChannelManager.getInstance();
    const plugin = manager.getChannelPlugin('discussion');

    if (!plugin || !plugin.inbound) {
      throw new Error('Discussion channel not available');
    }

    // 4. 选择第一个发言者
    const firstSpeaker = this.getNextSpeaker();
    if (!firstSpeaker) {
      throw new Error('No active participants in discussion');
    }

    // 5. 触发 inbound.handleMessage
    await plugin.inbound.handleMessage({
      peer: this.session.id,
      from: firstSpeaker.agentId,
      text: `You are ${firstSpeaker.role || firstSpeaker.name}. Please start the discussion on: ${this.session.topic}`,
      context: {
        channel: 'discussion',
        roomId: this.session.id,
        role: firstSpeaker.role || firstSpeaker.name,
        topic: this.session.topic,
        recentMessages: []
      }
    });
  }

  /**
   * 添加消息
   */
  async addMessage(agentId: string, content: string, type: DiscussionMessage['type'] = 'statement'): Promise<void> {
    const message: DiscussionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      content,
      type,
      timestamp: Date.now()
    };

    this.session.messages.push(message);
    this.session.updatedAt = Date.now();

    const store = await DiscussionStore.getInstance();
    await store.save(this.session);
    log.debug(`[DiscussionRoom] Message added from ${agentId}: ${content.slice(0, 50)}...`);
  }

  /**
   * 获取下一个发言者
   */
  getNextSpeaker(): DiscussionParticipant | null {
    const speaker = this.turnManager.getNextSpeaker();
    if (speaker) {
      this.session.currentSpeaker = speaker.agentId;
    }
    return speaker;
  }

  /**
   * 检测共识
   */
  async checkConsensus(): Promise<ConsensusResult> {
    const result = await this.consensusDetector.detect(this.session.messages);
    this.session.consensusLevel = result.level;
    const store = await DiscussionStore.getInstance();
    await store.save(this.session);
    return result;
  }

  /**
   * 结束讨论
   */
  async end(summary?: string): Promise<void> {
    this.session.status = 'completed';
    this.session.updatedAt = Date.now();

    if (summary) {
      await this.addMessage('system', summary, 'summary');
    }

    const store = await DiscussionStore.getInstance();
    await store.save(this.session);
    log.info(`[DiscussionRoom] Discussion ended: ${this.session.id}`);
  }

  /**
   * 暂停讨论
   */
  async pause(): Promise<void> {
    this.session.status = 'paused';
    this.session.updatedAt = Date.now();
    const store = await DiscussionStore.getInstance();
    await store.save(this.session);
  }

  /**
   * 恢复讨论
   */
  async resume(): Promise<void> {
    this.session.status = 'active';
    this.session.updatedAt = Date.now();
    const store = await DiscussionStore.getInstance();
    await store.save(this.session);
  }

  /**
   * 获取会话信息
   */
  getSession(): DiscussionSession {
    return { ...this.session };
  }

  /**
   * 获取消息历史
   */
  getMessages(): DiscussionMessage[] {
    return [...this.session.messages];
  }
}
