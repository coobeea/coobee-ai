/**
 * 自适应训练执行器 - Phase 4
 *
 * 核心功能：
 * - 集成难度自适应策略
 * - 集成弱点强化策略
 * - 根据训练策略动态选择任务
 */

import { TrainingExecutor } from './TrainingExecutor';
import { AdaptiveDifficultyManager } from './AdaptiveDifficultyManager';
import { WeaknessAnalyzer } from './WeaknessAnalyzer';
import type { TrainingSession, TrainingTask, TrainingStrategy, TrainingExecutorConfig } from './types';
import type { TrainingSessionStore } from './TrainingSessionStore';
import { log as logger } from '@main/common/logger';

export class AdaptiveTrainingExecutor extends TrainingExecutor {
  private readonly difficultyManager: AdaptiveDifficultyManager;
  private readonly weaknessAnalyzer: WeaknessAnalyzer;

  constructor(sessionStore: TrainingSessionStore, config: TrainingExecutorConfig) {
    super(sessionStore, config);
    this.difficultyManager = new AdaptiveDifficultyManager();
    this.weaknessAnalyzer = new WeaknessAnalyzer();
  }

  /**
   * 重写 getTask 方法，根据策略选择任务
   */
  protected async getTask(session: TrainingSession, round: number): Promise<TrainingTask> {
    const strategy = session.strategy;

    logger.info(`[AdaptiveTraining] 第 ${round} 轮，使用策略: ${strategy}`);

    switch (strategy) {
      case 'adaptive':
        return this.getAdaptiveTask(session);

      case 'weakness-targeted':
        return this.getWeaknessTargetedTask(session);

      default:
        // 默认使用基类的随机选择
        return super.getTask(session, round);
    }
  }

  /**
   * 难度自适应策略：根据近期表现调整难度
   */
  private getAdaptiveTask(session: TrainingSession): TrainingTask {
    const dataset = session.dataset;

    if (!dataset.trainSet || dataset.trainSet.length === 0) {
      throw new Error('[AdaptiveTraining] 数据集训练集为空');
    }

    // 使用难度自适应管理器选择任务
    const task = this.difficultyManager.selectTaskWithAdaptiveDifficulty(session, dataset.trainSet);

    logger.info(`[AdaptiveTraining] 自适应策略选择任务: ${task.id}, 难度=${task.difficulty || 3}`);

    return task;
  }

  /**
   * 弱点强化策略：针对弱点维度选择任务
   */
  private getWeaknessTargetedTask(session: TrainingSession): TrainingTask {
    const dataset = session.dataset;

    if (!dataset.trainSet || dataset.trainSet.length === 0) {
      throw new Error('[AdaptiveTraining] 数据集训练集为空');
    }

    // 1. 分析当前弱点
    const weakness = this.weaknessAnalyzer.analyze(session);

    if (weakness.weakDimensions.length === 0) {
      logger.info(`[AdaptiveTraining] 没有发现弱点，使用难度自适应策略`);
      return this.getAdaptiveTask(session);
    }

    // 2. 找出最弱的维度
    const weakestDimension = weakness.weakestDimension!;
    logger.info(
      `[AdaptiveTraining] 弱点强化: 目标维度="${weakestDimension.dimension}", 失败率=${(weakestDimension.failureRate * 100).toFixed(1)}%`
    );

    // 3. 从数据集中选择针对该维度的任务
    const targetedTasks = dataset.trainSet.filter((task) => {
      // 检查任务标签是否包含弱点维度
      return task.tags?.includes(weakestDimension.dimension);
    });

    if (targetedTasks.length > 0) {
      // 从针对性任务中随机选择
      const randomIndex = Math.floor(Math.random() * targetedTasks.length);
      const task = targetedTasks[randomIndex];
      logger.info(`[AdaptiveTraining] 弱点强化策略选择针对性任务: ${task.id}`);
      return task;
    } else {
      // 如果没有找到针对性任务，使用难度自适应策略
      logger.warn(`[AdaptiveTraining] 未找到针对 "${weakestDimension.dimension}" 的任务，回退到难度自适应`);
      return this.getAdaptiveTask(session);
    }
  }

  /**
   * 获取策略描述（用于日志和UI）
   */
  getStrategyDescription(strategy: TrainingStrategy): string {
    const descriptions: Record<TrainingStrategy, string> = {
      sequential: '串行训练：按顺序执行任务',
      parallel: '并行训练：同时执行多个任务',
      adaptive: '自适应训练：根据表现动态调整难度',
      'weakness-targeted': '弱点强化：针对薄弱维度重点训练'
    };

    return descriptions[strategy] || strategy;
  }
}
