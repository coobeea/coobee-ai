/**
 * TurnManager - 发言调度器
 *
 * 管理讨论中的发言顺序
 */

import { createLogger } from '@main/common/logger';
import type { DiscussionParticipant, TurnStrategy } from './types';

const log = createLogger('turn-manager');

export class TurnManager {
  private strategy: TurnStrategy;
  private participants: DiscussionParticipant[];
  private currentIndex = 0;

  constructor(strategy: TurnStrategy = 'round-robin') {
    this.strategy = strategy;
    this.participants = [];
  }

  /**
   * 设置参与者
   */
  setParticipants(participants: DiscussionParticipant[]): void {
    this.participants = participants.filter((p) => p.active);
    this.currentIndex = 0;
    log.debug(`[TurnManager] Participants set: ${this.participants.length}`);
  }

  /**
   * 获取下一个发言者
   */
  getNextSpeaker(): DiscussionParticipant | null {
    if (this.participants.length === 0) return null;

    switch (this.strategy) {
      case 'round-robin':
        return this.getRoundRobinSpeaker();

      case 'weighted':
        return this.getWeightedSpeaker();

      case 'reactive':
        return this.getReactiveSpeaker();

      case 'moderator-controlled':
        return null;

      default:
        return this.getRoundRobinSpeaker();
    }
  }

  /**
   * 轮流发言
   */
  private getRoundRobinSpeaker(): DiscussionParticipant {
    const speaker = this.participants[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.participants.length;
    return speaker;
  }

  /**
   * 加权随机（根据权重选择）
   */
  private getWeightedSpeaker(): DiscussionParticipant {
    const totalWeight = this.participants.reduce((sum, p) => sum + (p.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const participant of this.participants) {
      random -= participant.weight || 1;
      if (random <= 0) {
        return participant;
      }
    }

    return this.participants[0];
  }

  /**
   * 反应式（最近没发言的优先）
   */
  private getReactiveSpeaker(): DiscussionParticipant {
    return this.participants[this.currentIndex % this.participants.length];
  }

  /**
   * 手动指定下一个发言者
   */
  setSpeaker(agentId: string): boolean {
    const index = this.participants.findIndex((p) => p.agentId === agentId);
    if (index === -1) {
      log.warn(`[TurnManager] Agent ${agentId} not found in participants`);
      return false;
    }

    this.currentIndex = index;
    return true;
  }

  /**
   * 获取所有参与者
   */
  getParticipants(): DiscussionParticipant[] {
    return [...this.participants];
  }

  /**
   * 更改策略
   */
  setStrategy(strategy: TurnStrategy): void {
    this.strategy = strategy;
    log.info(`[TurnManager] Strategy changed to ${strategy}`);
  }
}
