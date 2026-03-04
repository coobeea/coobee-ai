/**
 * OpinionAggregator - 意见整合器
 *
 * 整合多位专家的意见，生成综合结论
 */

import { createLogger } from '@main/common/logger';
import type { ExpertOpinion, AggregationStrategy } from './types';

const log = createLogger('opinion-aggregator');

export class OpinionAggregator {
  /**
   * 聚合专家意见
   */
  async aggregate(opinions: ExpertOpinion[], strategy: AggregationStrategy = 'consensus-first'): Promise<string> {
    if (opinions.length === 0) {
      return '无专家意见';
    }

    log.info(`[OpinionAggregator] Aggregating ${opinions.length} opinions using ${strategy}`);

    switch (strategy) {
      case 'majority-vote':
        return this.majorityVote(opinions);

      case 'weighted-average':
        return this.weightedAverage(opinions);

      case 'consensus-first':
        return this.consensusFirst(opinions);

      case 'expert-ranking':
        return this.expertRanking(opinions);

      default:
        return this.consensusFirst(opinions);
    }
  }

  /**
   * 多数投票（简单多数）
   */
  private majorityVote(opinions: ExpertOpinion[]): string {
    const approvals = opinions.filter((o) => o.type === 'approval' || o.type === 'suggestion');
    const objections = opinions.filter((o) => o.type === 'objection' || o.type === 'warning');

    if (approvals.length > objections.length) {
      return `多数专家（${approvals.length}/${opinions.length}）支持该方案。\n\n核心建议：\n${approvals.map((o) => `- ${o.roleName}: ${o.content.slice(0, 100)}`).join('\n')}`;
    } else {
      return `多数专家（${objections.length}/${opinions.length}）对该方案有疑虑。\n\n主要顾虑：\n${objections.map((o) => `- ${o.roleName}: ${o.content.slice(0, 100)}`).join('\n')}`;
    }
  }

  /**
   * 加权平均（基于置信度）
   */
  private weightedAverage(opinions: ExpertOpinion[]): string {
    const totalConfidence = opinions.reduce((sum, o) => sum + o.confidence, 0);
    const avgConfidence = totalConfidence / opinions.length;

    const sortedByConfidence = [...opinions].sort((a, b) => b.confidence - a.confidence);

    return `综合分析（平均置信度: ${(avgConfidence * 100).toFixed(1)}%）：\n\n${sortedByConfidence
      .map((o, i) => `${i + 1}. ${o.roleName}（置信度 ${(o.confidence * 100).toFixed(0)}%）:\n   ${o.content.slice(0, 150)}`)
      .join('\n\n')}`;
  }

  /**
   * 共识优先（寻找共同点）
   */
  private consensusFirst(opinions: ExpertOpinion[]): string {
    const agreementKeywords = this.extractCommonKeywords(opinions);

    const sections = [
      '## 专家会诊综合结论\n',
      `参与专家：${opinions.map((o) => o.roleName).join('、')}\n`,
      '### 共识点\n'
    ];

    if (agreementKeywords.length > 0) {
      sections.push(agreementKeywords.map((k) => `- ${k}`).join('\n'));
    } else {
      sections.push('（各方意见差异较大，未达成明显共识）');
    }

    sections.push('\n### 各方观点\n');
    sections.push(
      opinions
        .map((o, i) => `${i + 1}. **${o.roleName}**（${this.typeLabel(o.type)}）:\n   ${o.content.slice(0, 200)}`)
        .join('\n\n')
    );

    return sections.join('\n');
  }

  /**
   * 专家排名（根据历史表现）
   */
  private expertRanking(opinions: ExpertOpinion[]): string {
    const sortedByConfidence = [...opinions].sort((a, b) => b.confidence - a.confidence);

    return `按专家权威度排序的建议：\n\n${sortedByConfidence
      .map(
        (o, i) =>
          `${i + 1}. ${o.roleName}（${this.typeLabel(o.type)}，置信度 ${(o.confidence * 100).toFixed(0)}%）:\n   ${o.content}`
      )
      .join('\n\n')}`;
  }

  /**
   * 提取共同关键词（简化实现）
   */
  private extractCommonKeywords(opinions: ExpertOpinion[]): string[] {
    const allWords = opinions.flatMap((o) => o.content.split(/\s+/).filter((w) => w.length > 2));
    const wordCount = new Map<string, number>();

    for (const word of allWords) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }

    const common = Array.from(wordCount.entries())
      .filter(([_word, count]) => count >= Math.ceil(opinions.length / 2))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    return common;
  }

  /**
   * 意见类型标签
   */
  private typeLabel(type: ExpertOpinion['type']): string {
    const map: Record<string, string> = {
      analysis: '分析',
      suggestion: '建议',
      warning: '警告',
      approval: '赞成',
      objection: '反对'
    };
    return map[type] || type;
  }
}
