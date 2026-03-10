/**
 * 测试集验证器 - Phase 2
 *
 * 核心特性：
 * - 训练集/测试集分离
 * - 测试集验证（训练后在测试集上评估）
 * - 泛化能力分析（训练集得分 vs 测试集得分）
 * - 过拟合检测
 */

import { AgentDelegator } from './AgentDelegator';
import type { TrainingSession, TrainingReport } from './types';
import { log as logger } from '@main/common/logger';

export interface TestSetValidationResult {
  /** 测试集平均得分 */
  testScore: number;

  /** 训练集平均得分 */
  trainScore: number;

  /** 泛化差距（trainScore - testScore） */
  generalizationGap: number;

  /** 是否过拟合（gap > 15 视为过拟合） */
  isOverfitting: boolean;

  /** 测试集详细结果 */
  testResults: {
    taskId: string;
    score: number;
    passed: boolean;
  }[];
}

export class TestSetValidator {
  private readonly delegator: AgentDelegator;

  constructor(delegator: AgentDelegator) {
    this.delegator = delegator;
  }

  /**
   * 对训练后的智能体进行测试集验证
   */
  async validate(session: TrainingSession): Promise<TestSetValidationResult> {
    const testSet = session.dataset.testSet;

    if (!testSet || testSet.length === 0) {
      logger.warn('[TestSetValidator] 测试集为空，跳过验证');
      return {
        testScore: 0,
        trainScore: this.calculateAvgScore(session.results.map((r) => r.evaluation)),
        generalizationGap: 0,
        isOverfitting: false,
        testResults: []
      };
    }

    logger.info(`[TestSetValidator] 开始测试集验证: 测试任务数 = ${testSet.length}`);

    // 在测试集上逐个评估
    const testResults: { taskId: string; score: number; passed: boolean }[] = [];

    for (const task of testSet) {
      try {
        // 执行任务
        const output = await this.delegator.executeTask(session.agentId, task);

        // 评估结果
        const evaluation = await this.delegator.evaluateOutput(task, output);

        testResults.push({
          taskId: task.id,
          score: evaluation.score,
          passed: evaluation.passed
        });

        logger.debug(`[TestSetValidator] 测试任务 ${task.id}: ${evaluation.score}分`);
      } catch (err) {
        logger.error(`[TestSetValidator] 测试任务失败: ${task.id}`, err);
        // 失败视为 0 分
        testResults.push({
          taskId: task.id,
          score: 0,
          passed: false
        });
      }
    }

    // 计算统计数据
    const testScore = this.calculateAvgScore(testResults.map((r) => ({ score: r.score })));
    const trainScore = this.calculateAvgScore(session.results.map((r) => r.evaluation));
    const generalizationGap = trainScore - testScore;
    const isOverfitting = generalizationGap > 15; // 差距 > 15 视为过拟合

    logger.info(
      `[TestSetValidator] 验证完成: 训练集=${trainScore.toFixed(1)}, 测试集=${testScore.toFixed(1)}, 差距=${generalizationGap.toFixed(1)} ${isOverfitting ? '⚠️ 过拟合' : '✓ 正常'}`
    );

    return {
      testScore,
      trainScore,
      generalizationGap,
      isOverfitting,
      testResults
    };
  }

  /**
   * 计算平均得分
   */
  private calculateAvgScore(evaluations: { score: number }[]): number {
    if (evaluations.length === 0) return 0;
    const sum = evaluations.reduce((acc, e) => acc + e.score, 0);
    return sum / evaluations.length;
  }

  /**
   * 更新训练报告（添加测试集验证数据）
   */
  updateReportWithValidation(report: TrainingReport, validation: TestSetValidationResult): TrainingReport {
    return {
      ...report,
      testSetValidation: {
        testScore: validation.testScore,
        trainScore: validation.trainScore,
        generalizationGap: validation.generalizationGap,
        isOverfitting: validation.isOverfitting
      }
    };
  }
}
