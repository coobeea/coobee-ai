/**
 * DiscussionRoom - 智能体讨论室（统一入口）
 *
 * 职责：
 *   1. 提供创建讨论室的入口
 *   2. 委托给 DiscussionCoordinator 进行实际协调
 *   3. 保持向后兼容（Facade 模式）
 *
 * 设计变更：
 *   - 旧：DiscussionRoom 直接管理 session + TurnManager
 *   - 新：DiscussionRoom 委托给 DiscussionCoordinator，Coordinator 接入 ThreadWaker
 */

import { createLogger } from '@main/common/logger';
import { DiscussionCoordinator } from './DiscussionCoordinator';
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

/**
 * DiscussionRoom（Facade）
 */
export class DiscussionRoom {
  private coordinator: DiscussionCoordinator;

  constructor(options: DiscussionOptions) {
    // 委托给 DiscussionCoordinator
    // 将 TurnStrategy 映射为 sequential/concurrent
    const mapTurnMode = (strategy?: TurnStrategy): 'sequential' | 'concurrent' => {
      if (strategy === 'concurrent') return 'concurrent';
      return 'sequential'; // round-robin, weighted, reactive 等都映射为 sequential
    };

    this.coordinator = new DiscussionCoordinator({
      topic: options.topic,
      participants: options.participants,
      consensusThreshold: options.consensusThreshold,
      maxRounds: options.maxRounds,
      defaultTurnMode: mapTurnMode(options.turnStrategy)
    });
  }

  /**
   * 开始讨论
   */
  async start(): Promise<void> {
    await this.coordinator.start();
  }

  /**
   * 获取讨论室 ID
   */
  getId(): string {
    return this.coordinator.getThreadId();
  }

  /**
   * 获取会话信息
   */
  getSession(): DiscussionSession {
    return this.coordinator.getSession();
  }

  /**
   * 暂停讨论
   */
  async pause(): Promise<void> {
    await this.coordinator.pause();
  }

  /**
   * 恢复讨论（从暂停状态恢复）
   */
  async resume(): Promise<void> {
    await this.coordinator.resume();
  }

  /**
   * 继续讨论（追加新问题，重置轮次，保留历史）
   *
   * @param newTopic - 新的讨论主题/问题
   */
  async continueWith(newTopic: string): Promise<void> {
    await this.coordinator.continueWith(newTopic);
  }

  /**
   * 获取消息历史
   */
  async getMessages(): Promise<DiscussionMessage[]> {
    const session = this.coordinator.getSession();
    return [...session.messages];
  }

  /**
   * 添加消息（手动）
   */
  async addMessage(agentId: string, content: string, type: DiscussionMessage['type'] = 'statement'): Promise<void> {
    const store = await DiscussionStore.getInstance();
    await store.addMessage(this.coordinator.getThreadId(), {
      participant: agentId,
      content,
      timestamp: Date.now(),
      type
    });
  }

  /**
   * 检测共识
   */
  async checkConsensus(): Promise<ConsensusResult> {
    const session = this.coordinator.getSession();
    const detector = new (await import('./ConsensusDetector')).ConsensusDetector();
    return await detector.detect(session.messages, session.consensusThreshold);
  }

  /**
   * 获取下一个发言者（兼容旧 API）
   */
  getNextSpeaker(): DiscussionParticipant | null {
    // 在新架构下，发言者由 Coordinator 管理，这里返回 null
    // 如果需要，可以从 Coordinator 的 metadata 中获取
    log.warn('[DiscussionRoom] getNextSpeaker() is deprecated in Coordinator mode');
    return null;
  }

  /**
   * 结束讨论（手动）
   */
  async end(_summary?: string): Promise<void> {
    // Coordinator 自己会处理结束逻辑
    log.info(`[DiscussionRoom] Manual end requested: ${this.coordinator.getThreadId()}`);
    // 这里可以调用 Coordinator 的 pause() 或其他方法
  }

  /**
   * 从现有 session 恢复 DiscussionRoom（用于外部调用）
   */
  static async fromSession(sessionId: string): Promise<DiscussionRoom> {
    const store = await DiscussionStore.getInstance();
    const session = await store.get(sessionId);

    if (!session) {
      throw new Error(`Discussion session ${sessionId} not found`);
    }

    // 创建 Room Facade（实际由 Coordinator 恢复）
    const room = new DiscussionRoom({
      topic: session.topic,
      participants: session.participants,
      turnStrategy: session.turnStrategy,
      consensusThreshold: session.consensusThreshold,
      maxRounds: session.maxRounds
    });

    // 替换为恢复的 Coordinator
    room.coordinator = await DiscussionCoordinator.resume(sessionId);

    return room;
  }
}
