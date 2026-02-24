/**
 * BrainMetrics - Brain Skill 使用监控
 *
 * 职责：
 * - 统计 Brain Search/Publish 调用次数
 * - 计算命中率
 * - 按 Agent 分组统计
 * - 持久化统计数据
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';

/** Brain 工具调用类型 */
export type BrainToolType = 'search' | 'publish';

/** Brain 工具调用记录 */
export interface BrainCallRecord {
  /** 记录 ID */
  id: string;

  /** 工具类型 */
  toolType: BrainToolType;

  /** Agent ID */
  agentId: string;

  /** 调用时间 */
  timestamp: string;

  /** 是否成功 */
  success: boolean;

  /** 是否命中（仅 search） */
  hit?: boolean;

  /** 查询内容（仅 search） */
  query?: string;

  /** 结果数量（仅 search） */
  resultCount?: number;

  /** 发布主题（仅 publish） */
  topic?: string;

  /** 错误信息 */
  error?: string;
}

/** Brain 统计数据 */
export interface BrainStats {
  /** 总搜索次数 */
  totalSearches: number;

  /** 总发布次数 */
  totalPublishes: number;

  /** 搜索命中次数 */
  searchHits: number;

  /** 搜索命中率 */
  hitRate: number;

  /** 成功率 */
  successRate: number;

  /** 按 Agent 统计 */
  byAgent: Record<
    string,
    {
      searches: number;
      publishes: number;
      hits: number;
      hitRate: number;
    }
  >;

  /** 最近 N 条记录 */
  recentRecords: BrainCallRecord[];
}

export class BrainMetrics {
  private metricsDir: string;
  private recordsFile: string;
  private records: BrainCallRecord[] = [];
  private maxRecords = 1000; // 最多保留 1000 条记录

  constructor() {
    this.metricsDir = path.join(Env.paths.userHome, 'metrics');
    this.recordsFile = path.join(this.metricsDir, 'brain-records.json');
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.metricsDir, { recursive: true });
    await this.loadRecords();
    log.info('[BrainMetrics] 已初始化');
  }

  /**
   * 记录工具调用
   */
  async recordCall(record: Omit<BrainCallRecord, 'id' | 'timestamp'>): Promise<void> {
    const fullRecord: BrainCallRecord = {
      ...record,
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString()
    };

    this.records.push(fullRecord);

    // 限制记录数量
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    await this.saveRecords();

    log.debug(`[BrainMetrics] 记录工具调用: ${record.toolType} by ${record.agentId} (success: ${record.success})`);
  }

  /**
   * 获取统计数据
   */
  getStats(options?: { agentId?: string; since?: Date }): BrainStats {
    let filteredRecords = this.records;

    // 按 Agent 过滤
    if (options?.agentId) {
      filteredRecords = filteredRecords.filter((r) => r.agentId === options.agentId);
    }

    // 按时间过滤
    if (options?.since) {
      filteredRecords = filteredRecords.filter((r) => new Date(r.timestamp) >= options.since!);
    }

    const totalSearches = filteredRecords.filter((r) => r.toolType === 'search').length;
    const totalPublishes = filteredRecords.filter((r) => r.toolType === 'publish').length;
    const searchHits = filteredRecords.filter((r) => r.toolType === 'search' && r.hit === true).length;
    const successCount = filteredRecords.filter((r) => r.success).length;

    const hitRate = totalSearches > 0 ? searchHits / totalSearches : 0;
    const successRate = filteredRecords.length > 0 ? successCount / filteredRecords.length : 0;

    // 按 Agent 统计
    const byAgent: BrainStats['byAgent'] = {};
    const agentIds = Array.from(new Set(filteredRecords.map((r) => r.agentId)));

    for (const agentId of agentIds) {
      const agentRecords = filteredRecords.filter((r) => r.agentId === agentId);
      const searches = agentRecords.filter((r) => r.toolType === 'search').length;
      const publishes = agentRecords.filter((r) => r.toolType === 'publish').length;
      const hits = agentRecords.filter((r) => r.toolType === 'search' && r.hit === true).length;

      byAgent[agentId] = {
        searches,
        publishes,
        hits,
        hitRate: searches > 0 ? hits / searches : 0
      };
    }

    return {
      totalSearches,
      totalPublishes,
      searchHits,
      hitRate,
      successRate,
      byAgent,
      recentRecords: this.records.slice(-50) // 最近 50 条
    };
  }

  /**
   * 获取记录列表
   */
  getRecords(options?: {
    limit?: number;
    offset?: number;
    agentId?: string;
    toolType?: BrainToolType;
  }): BrainCallRecord[] {
    let filtered = this.records;

    if (options?.agentId) {
      filtered = filtered.filter((r) => r.agentId === options.agentId);
    }

    if (options?.toolType) {
      filtered = filtered.filter((r) => r.toolType === options.toolType);
    }

    // 倒序（最新的在前）
    filtered = filtered.reverse();

    const offset = options?.offset || 0;
    const limit = options?.limit || 50;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * 清空记录
   */
  async clearRecords(): Promise<void> {
    this.records = [];
    await this.saveRecords();
    log.info('[BrainMetrics] 已清空记录');
  }

  /**
   * 加载记录
   */
  private async loadRecords(): Promise<void> {
    try {
      const content = await fs.readFile(this.recordsFile, 'utf-8');
      this.records = JSON.parse(content);
      log.debug(`[BrainMetrics] 加载 ${this.records.length} 条历史记录`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = [];
        log.debug('[BrainMetrics] 未找到历史记录，初始化为空');
      } else {
        log.error('[BrainMetrics] 加载记录失败', error);
        throw error;
      }
    }
  }

  /**
   * 保存记录
   */
  private async saveRecords(): Promise<void> {
    try {
      await fs.writeFile(this.recordsFile, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (error) {
      log.error('[BrainMetrics] 保存记录失败', error);
    }
  }
}

// 单例实例
let instance: BrainMetrics | null = null;

/**
 * 初始化 BrainMetrics
 */
export async function initializeBrainMetrics(): Promise<void> {
  if (instance) return;

  instance = new BrainMetrics();
  await instance.initialize();
}

/**
 * 获取 BrainMetrics 实例
 */
export function getBrainMetrics(): BrainMetrics {
  if (!instance) {
    throw new Error('BrainMetrics 未初始化，请先调用 initializeBrainMetrics()');
  }
  return instance;
}
