/**
 * PatternRecognizer - 模式识别器
 *
 * 从历史记录中识别成功模式
 */

import { createLogger } from '@main/common/logger';
import type { LearningRecord, LearningPattern, LearningConfig } from './types';

const log = createLogger('pattern-recognizer');

export class PatternRecognizer {
  /**
   * 识别模式
   */
  recognizePatterns(records: LearningRecord[], config: LearningConfig): LearningPattern[] {
    if (records.length < config.minSampleSize) {
      log.warn(`[PatternRecognizer] Insufficient samples: ${records.length} < ${config.minSampleSize}`);
      return [];
    }

    const groupedByTaskType = this.groupByTaskType(records);

    const patterns: LearningPattern[] = [];
    let patternIndex = 0;

    for (const [taskType, taskRecords] of groupedByTaskType.entries()) {
      const strategyStats = this.analyzeStrategies(taskRecords);

      for (const [strategy, stats] of strategyStats.entries()) {
        if (stats.count < 3) continue;

        const confidence = stats.successRate * (Math.min(stats.count, 10) / 10);

        if (confidence >= config.confidenceThreshold) {
          patterns.push({
            id: `pattern-${patternIndex++}`,
            name: `${taskType} - ${strategy}`,
            taskType,
            recommendedStrategy: strategy,
            confidence,
            supportCount: stats.count,
            avgQualityScore: stats.avgQuality,
            lastUpdated: Date.now()
          });
        }
      }
    }

    log.info(`[PatternRecognizer] Recognized ${patterns.length} patterns from ${records.length} records`);

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 按任务类型分组
   */
  private groupByTaskType(records: LearningRecord[]): Map<string, LearningRecord[]> {
    const groups = new Map<string, LearningRecord[]>();

    for (const record of records) {
      const existing = groups.get(record.taskType) || [];
      existing.push(record);
      groups.set(record.taskType, existing);
    }

    return groups;
  }

  /**
   * 分析策略效果
   */
  private analyzeStrategies(records: LearningRecord[]): Map<
    string,
    {
      count: number;
      successRate: number;
      avgQuality: number;
    }
  > {
    const stats = new Map<string, { count: number; successCount: number; totalQuality: number }>();

    for (const record of records) {
      const existing = stats.get(record.strategy) || {
        count: 0,
        successCount: 0,
        totalQuality: 0
      };

      existing.count++;
      if (record.outcome === 'success') existing.successCount++;
      existing.totalQuality += record.qualityScore;

      stats.set(record.strategy, existing);
    }

    const result = new Map<string, { count: number; successRate: number; avgQuality: number }>();

    for (const [strategy, data] of stats.entries()) {
      result.set(strategy, {
        count: data.count,
        successRate: data.successCount / data.count,
        avgQuality: data.totalQuality / data.count
      });
    }

    return result;
  }
}
