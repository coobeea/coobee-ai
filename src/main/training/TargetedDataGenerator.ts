/**
 * 针对性数据生成器 - Phase 3
 *
 * 核心功能：
 * - 根据弱点分析结果生成针对性训练任务
 * - 调用 training-data-generator Agent
 * - 支持多维度并行生成
 * - 难度自适应
 */

import { AgentDelegator } from './AgentDelegator';
import { WeaknessAnalyzer } from './WeaknessAnalyzer';
import type { TrainingSession, TrainingTask, TrainingGoal } from './types';
import { log as logger } from '@main/common/logger';

export interface TargetedGenerationOptions {
  /** 生成任务数量 */
  count: number;
  /** 难度级别 (1-5) */
  difficulty?: number;
  /** 只针对最弱的维度 */
  focusWeakestOnly?: boolean;
}

export class TargetedDataGenerator {
  // private readonly delegator: AgentDelegator; // 暂时未使用，待 Phase 4 实现
  private readonly weaknessAnalyzer: WeaknessAnalyzer;

  constructor(_delegator: AgentDelegator) {
    // this.delegator = delegator;
    this.weaknessAnalyzer = new WeaknessAnalyzer();
  }

  /**
   * 根据训练会话的弱点生成针对性任务
   */
  async generateForSession(session: TrainingSession, options: TargetedGenerationOptions): Promise<TrainingTask[]> {
    logger.info(`[TargetedDataGenerator] 开始为会话 ${session.id} 生成 ${options.count} 个针对性任务`);

    // 1. 分析弱点
    const weakness = this.weaknessAnalyzer.analyze(session);

    if (weakness.weakDimensions.length === 0) {
      logger.info(`[TargetedDataGenerator] 没有发现弱点，生成通用任务`);
      return this.generateGenericTasks(session.goal, options.count, options.difficulty);
    }

    // 2. 确定目标维度
    const targetDimensions = options.focusWeakestOnly
      ? [weakness.weakestDimension!]
      : weakness.weakDimensions.slice(0, 3); // 最多针对前 3 个弱点维度

    logger.info(`[TargetedDataGenerator] 目标维度: ${targetDimensions.map((d) => d.dimension).join(', ')}`);

    // 3. 为每个维度生成任务
    const tasks: TrainingTask[] = [];
    const tasksPerDimension = Math.ceil(options.count / targetDimensions.length);

    for (const dim of targetDimensions) {
      const dimTasks = await this.generateForDimension(
        session.goal,
        dim.dimension,
        tasksPerDimension,
        options.difficulty
      );
      tasks.push(...dimTasks);

      if (tasks.length >= options.count) {
        break;
      }
    }

    // 4. 截断到目标数量
    const result = tasks.slice(0, options.count);
    logger.info(`[TargetedDataGenerator] 生成完成: ${result.length} 个任务`);

    return result;
  }

  /**
   * 为特定维度生成任务
   *
   * 暂时返回空数组，待后续实现真正的通过 Agent 生成
   */
  private async generateForDimension(
    _goal: TrainingGoal,
    dimension: string,
    count: number,
    _difficulty?: number
  ): Promise<TrainingTask[]> {
    logger.info(`[TargetedDataGenerator] 为维度 "${dimension}" 生成 ${count} 个任务（暂未实现）`);

    // TODO: 实现通过 training-data-generator Agent 生成任务
    // 需要重新设计 AgentDelegator.generateTask 的签名以支持批量生成

    logger.warn(`[TargetedDataGenerator] 针对维度 "${dimension}" 的任务生成暂未实现，将返回空列表`);
    return [];
  }

  /**
   * 生成通用任务（没有明显弱点时）
   *
   * 暂时返回空数组，待后续实现真正的通过 Agent 生成
   */
  private async generateGenericTasks(
    _goal: TrainingGoal,
    count: number,
    _difficulty?: number
  ): Promise<TrainingTask[]> {
    logger.info(`[TargetedDataGenerator] 生成 ${count} 个通用任务（暂未实现）`);

    // TODO: 实现通过 training-data-generator Agent 生成任务
    // 需要重新设计 AgentDelegator.generateTask 的签名以支持批量生成

    logger.warn(`[TargetedDataGenerator] 通用任务生成暂未实现，将返回空列表`);
    return [];
  }

  // 数据生成方法待 Phase 4 实现（需重新设计 AgentDelegator.generateTask API）

  /**
   * 批量分析多个会话的共同弱点
   */
  analyzeCommonWeakness(sessions: TrainingSession[]): string[] {
    const dimensionCounts = new Map<string, number>();

    for (const session of sessions) {
      const analysis = this.weaknessAnalyzer.analyze(session);
      for (const dim of analysis.weakDimensions) {
        dimensionCounts.set(dim.dimension, (dimensionCounts.get(dim.dimension) || 0) + 1);
      }
    }

    // 按出现次数降序排序
    const sorted = Array.from(dimensionCounts.entries()).sort((a, b) => b[1] - a[1]);

    return sorted.map(([dim]) => dim);
  }
}
