/**
 * DiscussionRoom - 智能体讨论室
 *
 * 管理多个智能体进行结构化讨论，支持轮流发言、共识检测、讨论总结
 */

import { createLogger } from '@main/common/logger';
import { TurnManager } from './TurnManager';
import { ConsensusDetector } from './ConsensusDetector';
import { DiscussionStore } from './DiscussionStore';
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
  private store: DiscussionStore;

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
    this.store = new DiscussionStore();
  }

  /**
   * 开始讨论
   */
  async start(): Promise<void> {
    log.info(`[DiscussionRoom] Starting discussion: ${this.session.topic}`);
    await this.store.save(this.session);
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

    await this.store.save(this.session);
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
    await this.store.save(this.session);
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

    await this.store.save(this.session);
    log.info(`[DiscussionRoom] Discussion ended: ${this.session.id}`);
  }

  /**
   * 暂停讨论
   */
  async pause(): Promise<void> {
    this.session.status = 'paused';
    this.session.updatedAt = Date.now();
    await this.store.save(this.session);
  }

  /**
   * 恢复讨论
   */
  async resume(): Promise<void> {
    this.session.status = 'active';
    this.session.updatedAt = Date.now();
    await this.store.save(this.session);
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
