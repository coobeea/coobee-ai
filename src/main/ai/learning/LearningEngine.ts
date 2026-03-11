/**
 * LearningEngine - 自主学习引擎
 *
 * 从执行历史中学习，优化策略选择
 */

import { createLogger } from '@main/common/logger';
import { LearningStore } from './LearningStore';
import { PatternRecognizer } from './PatternRecognizer';
import type { LearningRecord, LearningPattern, StrategyRecommendation, LearningConfig } from './types';

const log = createLogger('learning-engine');

export class LearningEngine {
  private store: LearningStore;
  private recognizer: PatternRecognizer;
  private patterns: LearningPattern[] = [];
  private config: LearningConfig;

  constructor(storageDir: string, config: LearningConfig) {
    this.store = new LearningStore(storageDir);
    this.recognizer = new PatternRecognizer();
    this.config = config;

    this.loadPatterns();
  }

  /**
   * 记录任务执行
   */
  recordExecution(record: Omit<LearningRecord, 'id' | 'createdAt'>): void {
    const fullRecord: LearningRecord = {
      ...record,
      id: `record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now()
    };

    this.store.addRecord(fullRecord);

    log.info(`[LearningEngine] Recorded execution: ${record.taskId} (${record.outcome})`);
  }

  /**
   * 学习与更新模式
   */
  async learn(): Promise<void> {
    if (!this.config.enabled) {
      log.debug('[LearningEngine] Learning disabled');
      return;
    }

    const recentRecords = this.store.readRecords(1000);

    if (recentRecords.length < this.config.minSampleSize) {
      log.debug(`[LearningEngine] Insufficient samples for learning: ${recentRecords.length}`);
      return;
    }

    const newPatterns = this.recognizer.recognizePatterns(recentRecords, this.config);

    this.patterns = newPatterns;
    this.store.savePatterns(newPatterns);

    log.info(`[LearningEngine] Learning complete. Identified ${newPatterns.length} patterns`);
  }

  /**
   * 获取策略推荐
   */
  getRecommendation(taskType: string, currentStrategy?: string): StrategyRecommendation | null {
    const relevantPatterns = this.patterns
      .filter((p) => p.taskType === taskType)
      .sort((a, b) => b.confidence - a.confidence);

    if (relevantPatterns.length === 0) {
      log.debug(`[LearningEngine] No patterns found for task type: ${taskType}`);
      return null;
    }

    const bestPattern = relevantPatterns[0];

    if (currentStrategy && currentStrategy === bestPattern.recommendedStrategy) {
      log.debug(`[LearningEngine] Current strategy is already optimal`);
      return null;
    }

    const currentPatternData = relevantPatterns.find((p) => p.recommendedStrategy === currentStrategy);
    const currentQuality = currentPatternData?.avgQualityScore || 0.5;

    const expectedImprovement = bestPattern.avgQualityScore - currentQuality;

    return {
      currentStrategy: currentStrategy || 'unknown',
      recommendedStrategy: bestPattern.recommendedStrategy,
      expectedImprovement,
      confidence: bestPattern.confidence,
      reason: `基于 ${bestPattern.supportCount} 个历史案例，该策略平均质量分数为 ${(bestPattern.avgQualityScore * 100).toFixed(1)}%`
    };
  }

  /**
   * 获取所有模式
   */
  getPatterns(): LearningPattern[] {
    return [...this.patterns];
  }

  /**
   * 加载模式
   */
  private loadPatterns(): void {
    this.patterns = this.store.readPatterns();
    log.info(`[LearningEngine] Loaded ${this.patterns.length} patterns`);
  }

  /**
   * 获取统计信息
   */
  getStatistics(): ReturnType<typeof this.store.getStatistics> {
    return this.store.getStatistics();
  }
}
