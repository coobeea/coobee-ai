/**
 * ConsensusDetector - 共识检测器
 *
 * 分析讨论消息，判断是否达成共识
 */

import { createLogger } from '@main/common/logger';
import type { DiscussionMessage, ConsensusResult } from './types';

const log = createLogger('consensus-detector');

export class ConsensusDetector {
  /**
   * 检测共识
   *
   * 简单实现：基于关键词匹配和同意/反对比例
   * 未来可接入 LLM 进行语义分析
   */
  async detect(messages: DiscussionMessage[], threshold = 0.7): Promise<ConsensusResult> {
    if (messages.length === 0) {
      return { achieved: false, level: 0 };
    }

    const recentMessages = messages.slice(-10);
    const agreementCount = this.countAgreements(recentMessages);
    const disagreementCount = this.countDisagreements(recentMessages);

    const total = agreementCount + disagreementCount;
    if (total === 0) {
      return { achieved: false, level: 0 };
    }

    const level = agreementCount / total;
    const achieved = level >= threshold;

    log.info(`[ConsensusDetector] Consensus level: ${(level * 100).toFixed(1)}% (threshold: ${threshold * 100}%)`);

    if (achieved) {
      return {
        achieved: true,
        level,
        summary: this.generateSummary(recentMessages)
      };
    } else {
      return {
        achieved: false,
        level,
        disagreements: this.extractDisagreements(recentMessages)
      };
    }
  }

  /**
   * 统计同意数量
   */
  private countAgreements(messages: DiscussionMessage[]): number {
    const keywords = ['同意', '赞成', '支持', 'agree', 'support', 'approve', 'LGTM', '+1'];
    return messages.filter((m) => keywords.some((k) => m.content.toLowerCase().includes(k.toLowerCase()))).length;
  }

  /**
   * 统计反对数量
   */
  private countDisagreements(messages: DiscussionMessage[]): number {
    const keywords = ['反对', '不同意', '有异议', 'disagree', 'object', 'concern', '-1'];
    return messages.filter((m) => keywords.some((k) => m.content.toLowerCase().includes(k.toLowerCase()))).length;
  }

  /**
   * 生成共识摘要
   */
  private generateSummary(messages: DiscussionMessage[]): string {
    const lastMessage = messages[messages.length - 1];
    return `基于最近的讨论，各方基本达成一致：${lastMessage.content.slice(0, 100)}...`;
  }

  /**
   * 提取分歧点
   */
  private extractDisagreements(messages: DiscussionMessage[]): string[] {
    const disagreements: string[] = [];

    for (const msg of messages) {
      if (msg.type === 'objection') {
        disagreements.push(`${msg.agentId}: ${msg.content.slice(0, 80)}`);
      }
    }

    return disagreements;
  }
}
