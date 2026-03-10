/**
 * 难度自适应管理器 - Phase 4
 *
 * 核心功能：
 * - 根据近期训练表现动态调整任务难度
 * - 表现优秀时提升难度，表现不佳时降低难度
 * - 维持在合适的难度区间（不太简单也不太难）
 */

import type { TrainingSession, TrainingRoundResult, TrainingTask } from './types';
import { log as logger } from '@main/common/logger';

/**
 * 近期表现分析结果
 */
export interface RecentPerformance {
  /** 最近N轮的平均得分 */
  avgScore: number;
  /** 最近N轮的通过率 */
  passRate: number;
  /** 最近N轮的平均难度 */
  avgDifficulty: number;
  /** 最近N轮数量 */
  recentCount: number;
}

export class AdaptiveDifficultyManager {
  /**
   * 根据训练表现选择合适难度的任务
   */
  selectTaskWithAdaptiveDifficulty(session: TrainingSession, dataset: TrainingTask[]): TrainingTask {
    // 1. 分析近期表现（最近 10 轮）
    const recentPerformance = this.analyzeRecentPerformance(session.results, 10);

    // 2. 计算目标难度
    const targetDifficulty = this.calculateTargetDifficulty(recentPerformance);

    logger.info(
      `[AdaptiveDifficulty] 近期表现: 平均分=${recentPerformance.avgScore.toFixed(1)}, 通过率=${(recentPerformance.passRate * 100).toFixed(1)}%, 目标难度=${targetDifficulty}`
    );

    // 3. 从数据集中选择最接近目标难度的任务
    const task = this.selectTaskByDifficulty(dataset, targetDifficulty);

    return task;
  }

  /**
   * 分析近期表现
   */
  analyzeRecentPerformance(results: TrainingRoundResult[], windowSize: number = 10): RecentPerformance {
    if (results.length === 0) {
      return {
        avgScore: 0,
        passRate: 0,
        avgDifficulty: 3, // 默认中等难度
        recentCount: 0
      };
    }

    const recentResults = results.slice(-windowSize);
    const scores = recentResults.map((r) => r.evaluation.score);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    const passedCount = recentResults.filter((r) => r.evaluation.passed).length;
    const passRate = passedCount / recentResults.length;

    const difficulties = recentResults.map((r) => r.taskDifficulty || 3);
    const avgDifficulty = difficulties.reduce((sum, d) => sum + d, 0) / difficulties.length;

    return {
      avgScore: Math.round(avgScore * 10) / 10,
      passRate: Math.round(passRate * 100) / 100,
      avgDifficulty: Math.round(avgDifficulty * 10) / 10,
      recentCount: recentResults.length
    };
  }

  /**
   * 计算目标难度（1-5）
   */
  private calculateTargetDifficulty(performance: RecentPerformance): number {
    const { avgScore, avgDifficulty } = performance;

    // 如果是首次训练（无历史数据），从中等难度开始
    if (performance.recentCount === 0) {
      return 3;
    }

    let targetDifficulty = avgDifficulty;

    // 表现优秀（平均分 >= 85），提升难度
    if (avgScore >= 85) {
      targetDifficulty = Math.min(5, avgDifficulty + 1);
      logger.info(`[AdaptiveDifficulty] 表现优秀，提升难度: ${avgDifficulty.toFixed(1)} → ${targetDifficulty}`);
    }
    // 表现不佳（平均分 < 70），降低难度
    else if (avgScore < 70) {
      targetDifficulty = Math.max(1, avgDifficulty - 1);
      logger.info(`[AdaptiveDifficulty] 表现不佳，降低难度: ${avgDifficulty.toFixed(1)} → ${targetDifficulty}`);
    }
    // 表现中等，保持当前难度
    else {
      logger.info(`[AdaptiveDifficulty] 表现中等，保持难度: ${avgDifficulty.toFixed(1)}`);
    }

    return Math.round(targetDifficulty * 10) / 10;
  }

  /**
   * 从数据集中选择最接近目标难度的任务
   */
  private selectTaskByDifficulty(dataset: TrainingTask[], targetDifficulty: number): TrainingTask {
    if (dataset.length === 0) {
      throw new Error('[AdaptiveDifficulty] 数据集为空');
    }

    // 按难度接近程度排序
    const sortedTasks = [...dataset].sort((a, b) => {
      const diffA = Math.abs((a.difficulty || 3) - targetDifficulty);
      const diffB = Math.abs((b.difficulty || 3) - targetDifficulty);
      return diffA - diffB;
    });

    // 从前 3 个最接近的任务中随机选择一个（避免重复）
    const topN = Math.min(3, sortedTasks.length);
    const randomIndex = Math.floor(Math.random() * topN);
    const selectedTask = sortedTasks[randomIndex];

    logger.debug(
      `[AdaptiveDifficulty] 选择任务: ${selectedTask.id}, 难度=${selectedTask.difficulty || 3} (目标=${targetDifficulty})`
    );

    return selectedTask;
  }

  /**
   * 判断是否需要调整难度
   */
  shouldAdjustDifficulty(performance: RecentPerformance): boolean {
    // 表现极好或极差时需要调整
    return performance.avgScore >= 85 || performance.avgScore < 70;
  }

  /**
   * 获取难度调整建议
   */
  getDifficultyAdjustmentSuggestion(performance: RecentPerformance): string {
    if (performance.avgScore >= 85) {
      return '表现优秀，建议提升任务难度以持续挑战';
    } else if (performance.avgScore < 70) {
      return '表现不佳，建议降低任务难度以巩固基础';
    } else {
      return '表现中等，当前难度合适';
    }
  }
}
