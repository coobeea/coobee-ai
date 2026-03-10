/**
 * WeightCalculator - Agent 权重计算器
 *
 * 基于历史表现计算 Agent 的投票权重
 */

import { createLogger } from '@main/common/logger';
import type { AgentWeight } from './types';

const log = createLogger('weight-calculator');

interface PerformanceMetrics {
  tasksCompleted: number;
  tasksSuccessful: number;
  averageQuality: number;
  expertiseAreas: string[];
}

export class WeightCalculator {
  private weights = new Map<string, AgentWeight>();

  /**
   * 计算 Agent 权重
   */
  calculateWeight(agentId: string, metrics: PerformanceMetrics): AgentWeight {
    const baseWeight = 1.0;

    const successRate = metrics.tasksSuccessful / (metrics.tasksCompleted || 1);
    const qualityScore = metrics.averageQuality;

    const experienceFactor = Math.min(1.5, 1 + Math.log10(metrics.tasksCompleted + 1) / 2);

    const weight = baseWeight * successRate * qualityScore * experienceFactor;

    const normalizedWeight = Math.max(0.1, Math.min(2.0, weight));

    const agentWeight: AgentWeight = {
      agentId,
      weight: normalizedWeight,
      reason: `基于 ${metrics.tasksCompleted} 个任务的历史表现，成功率 ${(successRate * 100).toFixed(1)}%，质量分 ${(qualityScore * 100).toFixed(1)}%`,
      updatedAt: Date.now()
    };

    this.weights.set(agentId, agentWeight);

    log.debug(`[WeightCalculator] Weight calculated for ${agentId}: ${normalizedWeight.toFixed(2)}`);

    return agentWeight;
  }

  /**
   * 获取 Agent 权重
   */
  getWeight(agentId: string): AgentWeight | undefined {
    return this.weights.get(agentId);
  }

  /**
   * 获取所有权重
   */
  getAllWeights(): Map<string, AgentWeight> {
    return new Map(this.weights);
  }

  /**
   * 更新权重
   */
  updateWeight(agentId: string, weight: number, reason?: string): void {
    const existing = this.weights.get(agentId);

    this.weights.set(agentId, {
      agentId,
      weight: Math.max(0.1, Math.min(2.0, weight)),
      reason: reason || existing?.reason || '手动更新',
      updatedAt: Date.now()
    });

    log.info(`[WeightCalculator] Weight updated for ${agentId}: ${weight.toFixed(2)}`);
  }

  /**
   * 重置所有权重
   */
  resetWeights(): void {
    this.weights.clear();
    log.info('[WeightCalculator] All weights reset');
  }
}
