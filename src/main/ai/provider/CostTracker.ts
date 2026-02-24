/**
 * 成本追踪器
 *
 * 记录每次 API 调用的 token 用量和成本。
 */
import type { ModelCostConfig, ModelRef } from './types';
import { formatModelRef } from './types';

/** 单次调用用量 */
export interface UsageRecord {
  ref: ModelRef;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** 计算出的成本（美元） */
  cost: number;
}

/** 模型维度汇总 */
export interface ModelCostSummary {
  modelRef: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

export class CostTracker {
  private records: UsageRecord[] = [];

  /**
   * 记录一次 API 调用
   */
  record(
    ref: ModelRef,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    },
    costConfig?: ModelCostConfig
  ): UsageRecord {
    const cost = costConfig ? this.calculateCost(usage, costConfig) : 0;

    const record: UsageRecord = {
      ref,
      timestamp: Date.now(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cost
    };

    this.records.push(record);
    return record;
  }

  /**
   * 获取所有记录
   */
  getRecords(): UsageRecord[] {
    return [...this.records];
  }

  /**
   * 获取总成本
   */
  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * 获取总 token 数
   */
  getTotalTokens(): { input: number; output: number } {
    return this.records.reduce(
      (acc, r) => ({
        input: acc.input + r.inputTokens,
        output: acc.output + r.outputTokens
      }),
      { input: 0, output: 0 }
    );
  }

  /**
   * 按模型维度汇总
   */
  getSummaryByModel(): ModelCostSummary[] {
    const map = new Map<string, ModelCostSummary>();

    for (const r of this.records) {
      const key = formatModelRef(r.ref);
      const existing = map.get(key);
      if (existing) {
        existing.totalCalls++;
        existing.totalInputTokens += r.inputTokens;
        existing.totalOutputTokens += r.outputTokens;
        existing.totalCost += r.cost;
      } else {
        map.set(key, {
          modelRef: key,
          totalCalls: 1,
          totalInputTokens: r.inputTokens,
          totalOutputTokens: r.outputTokens,
          totalCost: r.cost
        });
      }
    }

    return Array.from(map.values());
  }

  /**
   * 获取指定时间范围内的记录
   */
  getRecordsSince(since: number): UsageRecord[] {
    return this.records.filter((r) => r.timestamp >= since);
  }

  /**
   * 清空所有记录
   */
  clear(): void {
    this.records = [];
  }

  // ─── 私有方法 ─────────────────────────────────────

  /**
   * 计算单次调用成本（美元）
   * 成本配置单位：$/百万 token
   */
  private calculateCost(
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    },
    costConfig: ModelCostConfig
  ): number {
    const M = 1_000_000;

    let cost = (usage.inputTokens / M) * costConfig.input + (usage.outputTokens / M) * costConfig.output;

    if (usage.cacheReadTokens && costConfig.cacheRead) {
      cost += (usage.cacheReadTokens / M) * costConfig.cacheRead;
    }
    if (usage.cacheWriteTokens && costConfig.cacheWrite) {
      cost += (usage.cacheWriteTokens / M) * costConfig.cacheWrite;
    }

    return cost;
  }
}
