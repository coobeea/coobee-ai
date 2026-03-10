/**
 * ModelGroupResolver - 模型组解析器
 *
 * 负责从模型组中选择一个具体的模型，支持多种负载均衡策略。
 */

import { log } from '@main/common/logger';

export type LoadBalanceStrategy = 'round-robin' | 'random' | 'weighted' | 'quota-aware' | 'fallback';

export interface ModelGroup {
  name: string;
  description?: string;
  models: string[];
  strategy: LoadBalanceStrategy;
  weights?: Record<string, number>;
  enabled: boolean;
}

export interface ModelSelectionContext {
  /** 当前 Agent ID（用于 round-robin 状态） */
  agentId?: string;

  /** 配额信息（用于 quota-aware 策略） */
  quotaInfo?: Record<
    string,
    {
      remaining: number;
      limit: number;
      resetAt: number;
    }
  >;

  /** 失败的模型列表（用于 fallback 策略） */
  failedModels?: string[];
}

/**
 * 模型组解析器
 */
export class ModelGroupResolver {
  private roundRobinCounters: Map<string, number> = new Map();

  constructor(private modelGroups: Record<string, ModelGroup>) {}

  /**
   * 从模型组中选择一个模型
   */
  resolveModel(groupName: string, context?: ModelSelectionContext): string | null {
    const group = this.modelGroups[groupName];

    if (!group || !group.enabled || group.models.length === 0) {
      log.warn(`[ModelGroupResolver] 模型组不存在或已禁用: ${groupName}`);
      return null;
    }

    const availableModels = group.models.filter((model) => !context?.failedModels?.includes(model));

    if (availableModels.length === 0) {
      log.error(`[ModelGroupResolver] 模型组 ${groupName} 中所有模型都已失败`);
      return null;
    }

    switch (group.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(groupName, availableModels, context);

      case 'random':
        return this.selectRandom(availableModels);

      case 'weighted':
        return this.selectWeighted(availableModels, group.weights);

      case 'quota-aware':
        return this.selectQuotaAware(availableModels, context);

      case 'fallback':
        return this.selectFallback(availableModels);

      default:
        log.warn(`[ModelGroupResolver] 未知策略 ${group.strategy}，使用 round-robin`);
        return this.selectRoundRobin(groupName, availableModels, context);
    }
  }

  /**
   * 轮询选择（依次轮流使用）
   */
  private selectRoundRobin(groupName: string, models: string[], context?: ModelSelectionContext): string {
    const key = `${groupName}:${context?.agentId || 'global'}`;
    const counter = this.roundRobinCounters.get(key) || 0;
    const selectedIndex = counter % models.length;
    this.roundRobinCounters.set(key, counter + 1);

    const selected = models[selectedIndex];
    log.debug(`[ModelGroupResolver] Round-Robin 选择: ${selected} (${selectedIndex + 1}/${models.length})`);
    return selected;
  }

  /**
   * 随机选择
   */
  private selectRandom(models: string[]): string {
    const selected = models[Math.floor(Math.random() * models.length)];
    log.debug(`[ModelGroupResolver] Random 选择: ${selected}`);
    return selected;
  }

  /**
   * 加权选择
   */
  private selectWeighted(models: string[], weights?: Record<string, number>): string {
    if (!weights || Object.keys(weights).length === 0) {
      log.warn('[ModelGroupResolver] Weighted 策略但未配置权重，使用 random');
      return this.selectRandom(models);
    }

    // 计算总权重
    const totalWeight = models.reduce((sum, model) => {
      return sum + (weights[model] || 0);
    }, 0);

    if (totalWeight === 0) {
      log.warn('[ModelGroupResolver] 总权重为 0，使用 random');
      return this.selectRandom(models);
    }

    // 随机选择
    let random = Math.random() * totalWeight;
    for (const model of models) {
      const weight = weights[model] || 0;
      random -= weight;
      if (random <= 0) {
        log.debug(`[ModelGroupResolver] Weighted 选择: ${model} (权重: ${weight})`);
        return model;
      }
    }

    return models[0];
  }

  /**
   * 配额感知选择（优先使用配额充足的模型）
   */
  private selectQuotaAware(models: string[], context?: ModelSelectionContext): string {
    if (!context?.quotaInfo) {
      log.warn('[ModelGroupResolver] Quota-aware 策略但未提供配额信息，使用 random');
      return this.selectRandom(models);
    }

    // 按剩余配额排序
    const sorted = models
      .map((model) => {
        const quota = context.quotaInfo![model];
        const remainingRatio = quota ? quota.remaining / quota.limit : 1.0;
        return { model, remainingRatio, remaining: quota?.remaining || Infinity };
      })
      .sort((a, b) => {
        if (a.remainingRatio !== b.remainingRatio) {
          return b.remainingRatio - a.remainingRatio;
        }
        return b.remaining - a.remaining;
      });

    const selected = sorted[0].model;
    log.debug(
      `[ModelGroupResolver] Quota-aware 选择: ${selected} (剩余比例: ${(sorted[0].remainingRatio * 100).toFixed(1)}%)`
    );
    return selected;
  }

  /**
   * 顺序尝试（失败后自动切换到下一个）
   */
  private selectFallback(models: string[]): string {
    const selected = models[0];
    log.debug(`[ModelGroupResolver] Fallback 选择: ${selected} (优先级: 1/${models.length})`);
    return selected;
  }

  /**
   * 重置 round-robin 计数器
   */
  resetCounter(groupName: string, agentId?: string): void {
    const key = `${groupName}:${agentId || 'global'}`;
    this.roundRobinCounters.delete(key);
    log.debug(`[ModelGroupResolver] 重置计数器: ${key}`);
  }

  /**
   * 清空所有计数器
   */
  clearAllCounters(): void {
    this.roundRobinCounters.clear();
    log.debug('[ModelGroupResolver] 清空所有计数器');
  }

  /**
   * 获取模型组的所有候选模型（用于故障转移重试）
   */
  getGroupCandidates(groupName: string): string[] {
    const group = this.modelGroups[groupName];
    if (!group || !group.enabled || group.models.length === 0) {
      return [];
    }
    return [...group.models];
  }
}
