/**
 * 弱点分析器 - Phase 3
 *
 * 核心功能：
 * - 分析训练结果中的薄弱维度
 * - 统计各维度的失败率
 * - 识别需要加强的方面
 * - 为针对性训练提供数据支持
 */

import type { TrainingSession, TrainingRoundResult } from './types';
import { log as logger } from '@main/common/logger';

/**
 * 维度统计
 */
export interface DimensionStats {
  /** 维度名称 */
  dimension: string;
  /** 该维度的平均得分 */
  avgScore: number;
  /** 该维度失败的轮次数 */
  failureCount: number;
  /** 该维度的总轮次数 */
  totalCount: number;
  /** 失败率 */
  failureRate: number;
  /** 是否为弱点（失败率 > 30% 或平均分 < 70） */
  isWeak: boolean;
}

/**
 * 弱点分析结果
 */
export interface WeaknessAnalysis {
  /** 所有维度的统计 */
  dimensionStats: DimensionStats[];
  /** 弱点维度（按失败率降序） */
  weakDimensions: DimensionStats[];
  /** 最弱的维度 */
  weakestDimension?: DimensionStats;
  /** 整体通过率 */
  overallPassRate: number;
  /** 分析的轮次数 */
  analyzedRounds: number;
}

export class WeaknessAnalyzer {
  /**
   * 分析训练会话，找出弱点维度
   */
  analyze(session: TrainingSession): WeaknessAnalysis {
    const results = session.results;

    if (results.length === 0) {
      logger.warn('[WeaknessAnalyzer] 没有训练结果，无法分析');
      return {
        dimensionStats: [],
        weakDimensions: [],
        overallPassRate: 0,
        analyzedRounds: 0
      };
    }

    logger.info(`[WeaknessAnalyzer] 开始分析 ${results.length} 轮训练结果`);

    // 1. 收集所有维度的评分
    const dimensionScores = new Map<string, number[]>();

    for (const result of results) {
      const feedback = result.evaluation.feedback;
      if (!feedback || typeof feedback !== 'object') {
        continue;
      }

      // 遍历 feedback 中的维度
      for (const [dimension, data] of Object.entries(feedback)) {
        if (!data || typeof data !== 'object' || !('score' in data)) {
          continue;
        }

        if (!dimensionScores.has(dimension)) {
          dimensionScores.set(dimension, []);
        }
        dimensionScores.get(dimension)!.push((data as { score: number }).score);
      }
    }

    // 2. 统计每个维度
    const dimensionStats: DimensionStats[] = [];

    for (const [dimension, scores] of dimensionScores.entries()) {
      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const failureCount = scores.filter((s) => s < 70).length;
      const totalCount = scores.length;
      const failureRate = failureCount / totalCount;
      const isWeak = failureRate > 0.3 || avgScore < 70;

      dimensionStats.push({
        dimension,
        avgScore: Math.round(avgScore * 10) / 10,
        failureCount,
        totalCount,
        failureRate: Math.round(failureRate * 100) / 100,
        isWeak
      });
    }

    // 3. 找出弱点维度（按失败率降序）
    const weakDimensions = dimensionStats.filter((d) => d.isWeak).sort((a, b) => b.failureRate - a.failureRate);

    // 4. 计算整体通过率
    const passedRounds = results.filter((r) => r.evaluation.passed).length;
    const overallPassRate = Math.round((passedRounds / results.length) * 100) / 100;

    const analysis: WeaknessAnalysis = {
      dimensionStats,
      weakDimensions,
      weakestDimension: weakDimensions[0],
      overallPassRate,
      analyzedRounds: results.length
    };

    logger.info(
      `[WeaknessAnalyzer] 分析完成: 弱点维度 ${weakDimensions.length} 个，整体通过率 ${(overallPassRate * 100).toFixed(1)}%`
    );

    if (weakDimensions.length > 0) {
      logger.info(
        `[WeaknessAnalyzer] 最弱维度: ${weakDimensions[0].dimension} (失败率 ${(weakDimensions[0].failureRate * 100).toFixed(1)}%)`
      );
    }

    return analysis;
  }

  /**
   * 分析最近 N 轮的弱点（用于动态调整）
   */
  analyzeRecent(results: TrainingRoundResult[], recentCount: number = 10): WeaknessAnalysis {
    const recentResults = results.slice(-recentCount);

    // 创建临时会话对象
    const tempSession: Pick<TrainingSession, 'results'> = { results: recentResults };

    return this.analyze(tempSession as TrainingSession);
  }

  /**
   * 格式化弱点分析为可读文本
   */
  formatAnalysis(analysis: WeaknessAnalysis): string {
    const lines: string[] = [];

    lines.push(`# 弱点分析报告`);
    lines.push(``);
    lines.push(`- 分析轮次: ${analysis.analyzedRounds}`);
    lines.push(`- 整体通过率: ${(analysis.overallPassRate * 100).toFixed(1)}%`);
    lines.push(`- 弱点维度数: ${analysis.weakDimensions.length}`);
    lines.push(``);

    if (analysis.weakDimensions.length > 0) {
      lines.push(`## 弱点维度（按失败率降序）`);
      lines.push(``);

      for (const dim of analysis.weakDimensions) {
        lines.push(`### ${dim.dimension}`);
        lines.push(`- 平均分: ${dim.avgScore.toFixed(1)}`);
        lines.push(`- 失败率: ${(dim.failureRate * 100).toFixed(1)}% (${dim.failureCount}/${dim.totalCount})`);
        lines.push(``);
      }
    } else {
      lines.push(`✅ 没有发现明显弱点维度，表现良好！`);
    }

    return lines.join('\n');
  }
}
