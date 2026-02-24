/**
 * MetricsCollector - 系统指标收集器
 *
 * 职责：
 * - 收集系统核心指标（Token、请求数、错误率、响应时间）
 * - 监控 Memory 工具使用情况
 * - 监控对话压缩事件
 * - 持久化指标数据
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';

/** 指标类型 */
export type MetricType = 'token_usage' | 'request' | 'error' | 'compression' | 'memory_tool' | 'response_time';

/** Token 使用记录 */
export interface TokenUsageMetric {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

/** 请求记录 */
export interface RequestMetric {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  model: string;
  duration: number;
  success: boolean;
  error?: string;
}

/** 压缩事件记录 */
export interface CompressionMetric {
  timestamp: string;
  sessionId: string;
  beforeTokens: number;
  afterTokens: number;
  compressionRatio: number;
  duration: number;
}

/** Memory 工具使用记录 */
export interface MemoryToolMetric {
  timestamp: string;
  sessionId: string;
  agentId?: string;
  operation: 'store' | 'retrieve' | 'search';
  success: boolean;
  duration: number;
}

/** 聚合统计 */
export interface AggregatedMetrics {
  /** 时间范围 */
  timeRange: {
    start: string;
    end: string;
  };

  /** Token 统计 */
  tokens: {
    total: number;
    prompt: number;
    completion: number;
    totalCost: number;
  };

  /** 请求统计 */
  requests: {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  };

  /** 压缩统计 */
  compressions: {
    total: number;
    avgCompressionRatio: number;
    totalTokensSaved: number;
  };

  /** Memory 工具统计 */
  memoryTool: {
    total: number;
    byOperation: Record<'store' | 'retrieve' | 'search', number>;
    successRate: number;
  };

  /** 按模型统计 */
  byModel: Record<
    string,
    {
      requests: number;
      tokens: number;
      cost: number;
    }
  >;
}

export class MetricsCollector {
  private metricsDir: string;
  private tokenUsageFile: string;
  private requestsFile: string;
  private compressionsFile: string;
  private memoryToolFile: string;

  private tokenUsages: TokenUsageMetric[] = [];
  private requests: RequestMetric[] = [];
  private compressions: CompressionMetric[] = [];
  private memoryTools: MemoryToolMetric[] = [];

  private maxRecordsPerFile = 10000;

  constructor() {
    this.metricsDir = path.join(Env.paths.userHome, 'metrics');
    this.tokenUsageFile = path.join(this.metricsDir, 'token-usage.json');
    this.requestsFile = path.join(this.metricsDir, 'requests.json');
    this.compressionsFile = path.join(this.metricsDir, 'compressions.json');
    this.memoryToolFile = path.join(this.metricsDir, 'memory-tool.json');
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.metricsDir, { recursive: true });
    await this.loadAll();
    log.info('[MetricsCollector] 已初始化');
  }

  /**
   * 记录 Token 使用
   */
  async recordTokenUsage(metric: Omit<TokenUsageMetric, 'timestamp'>): Promise<void> {
    const fullMetric: TokenUsageMetric = {
      ...metric,
      timestamp: new Date().toISOString()
    };

    this.tokenUsages.push(fullMetric);
    await this.trimAndSave('token', this.tokenUsages, this.tokenUsageFile);
  }

  /**
   * 记录请求
   */
  async recordRequest(metric: Omit<RequestMetric, 'timestamp'>): Promise<void> {
    const fullMetric: RequestMetric = {
      ...metric,
      timestamp: new Date().toISOString()
    };

    this.requests.push(fullMetric);
    await this.trimAndSave('request', this.requests, this.requestsFile);
  }

  /**
   * 记录压缩事件
   */
  async recordCompression(metric: Omit<CompressionMetric, 'timestamp'>): Promise<void> {
    const fullMetric: CompressionMetric = {
      ...metric,
      timestamp: new Date().toISOString()
    };

    this.compressions.push(fullMetric);
    await this.trimAndSave('compression', this.compressions, this.compressionsFile);

    log.info(
      `[MetricsCollector] 压缩事件: ${metric.beforeTokens} → ${metric.afterTokens} tokens (${(metric.compressionRatio * 100).toFixed(1)}%)`
    );
  }

  /**
   * 记录 Memory 工具使用
   */
  async recordMemoryTool(metric: Omit<MemoryToolMetric, 'timestamp'>): Promise<void> {
    const fullMetric: MemoryToolMetric = {
      ...metric,
      timestamp: new Date().toISOString()
    };

    this.memoryTools.push(fullMetric);
    await this.trimAndSave('memory', this.memoryTools, this.memoryToolFile);
  }

  /**
   * 获取聚合统计
   */
  getAggregatedMetrics(options?: { since?: Date; until?: Date; sessionId?: string }): AggregatedMetrics {
    const now = new Date();
    const start = options?.since || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const end = options?.until || now;

    // 过滤记录
    const filteredTokens = this.filterByTime(this.tokenUsages, start, end, options?.sessionId);
    const filteredRequests = this.filterByTime(this.requests, start, end, options?.sessionId);
    const filteredCompressions = this.filterByTime(this.compressions, start, end, options?.sessionId);
    const filteredMemory = this.filterByTime(this.memoryTools, start, end, options?.sessionId);

    // Token 统计
    const totalTokens = filteredTokens.reduce((sum, m) => sum + m.totalTokens, 0);
    const promptTokens = filteredTokens.reduce((sum, m) => sum + m.promptTokens, 0);
    const completionTokens = filteredTokens.reduce((sum, m) => sum + m.completionTokens, 0);
    const totalCost = filteredTokens.reduce((sum, m) => sum + (m.cost || 0), 0);

    // 请求统计
    const totalRequests = filteredRequests.length;
    const successRequests = filteredRequests.filter((r) => r.success).length;
    const failedRequests = totalRequests - successRequests;
    const avgDuration =
      totalRequests > 0 ? filteredRequests.reduce((sum, r) => sum + r.duration, 0) / totalRequests : 0;

    // 压缩统计
    const totalCompressions = filteredCompressions.length;
    const avgCompressionRatio =
      totalCompressions > 0
        ? filteredCompressions.reduce((sum, c) => sum + c.compressionRatio, 0) / totalCompressions
        : 0;
    const totalTokensSaved = filteredCompressions.reduce((sum, c) => sum + (c.beforeTokens - c.afterTokens), 0);

    // Memory 工具统计
    const totalMemory = filteredMemory.length;
    const memorySuccess = filteredMemory.filter((m) => m.success).length;
    const memoryByOp: Record<'store' | 'retrieve' | 'search', number> = {
      store: 0,
      retrieve: 0,
      search: 0
    };
    for (const m of filteredMemory) {
      memoryByOp[m.operation]++;
    }

    // 按模型统计
    const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};
    for (const token of filteredTokens) {
      if (!byModel[token.model]) {
        byModel[token.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      byModel[token.model].tokens += token.totalTokens;
      byModel[token.model].cost += token.cost || 0;
    }
    for (const req of filteredRequests) {
      if (!byModel[req.model]) {
        byModel[req.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      byModel[req.model].requests++;
    }

    return {
      timeRange: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      tokens: {
        total: totalTokens,
        prompt: promptTokens,
        completion: completionTokens,
        totalCost
      },
      requests: {
        total: totalRequests,
        success: successRequests,
        failed: failedRequests,
        successRate: totalRequests > 0 ? successRequests / totalRequests : 0,
        avgDuration
      },
      compressions: {
        total: totalCompressions,
        avgCompressionRatio,
        totalTokensSaved
      },
      memoryTool: {
        total: totalMemory,
        byOperation: memoryByOp,
        successRate: totalMemory > 0 ? memorySuccess / totalMemory : 0
      },
      byModel
    };
  }

  /** 记录查询选项 */
  getCompressions(options?: { since?: Date; until?: Date; sessionId?: string }): CompressionMetric[] {
    const { start, end } = this.parseTimeRange(options);
    return this.filterByTime(this.compressions, start, end, options?.sessionId);
  }

  getMemoryTools(options?: { since?: Date; until?: Date; sessionId?: string }): MemoryToolMetric[] {
    const { start, end } = this.parseTimeRange(options);
    return this.filterByTime(this.memoryTools, start, end, options?.sessionId);
  }

  getTokenUsages(options?: { since?: Date; until?: Date; sessionId?: string }): TokenUsageMetric[] {
    const { start, end } = this.parseTimeRange(options);
    return this.filterByTime(this.tokenUsages, start, end, options?.sessionId);
  }

  getRequests(options?: { since?: Date; until?: Date; sessionId?: string }): RequestMetric[] {
    const { start, end } = this.parseTimeRange(options);
    return this.filterByTime(this.requests, start, end, options?.sessionId);
  }

  /**
   * 获取压缩事件（分页）
   */
  getCompressionEvents(limit: number, offset: number): CompressionMetric[] {
    return this.compressions.slice(offset, offset + limit);
  }

  /**
   * 获取压缩事件总数
   */
  getCompressionEventsCount(): number {
    return this.compressions.length;
  }

  /**
   * 获取 Memory 工具统计（分页）
   */
  getMemoryStats(limit: number, offset: number): MemoryToolMetric[] {
    return this.memoryTools.slice(offset, offset + limit);
  }

  /**
   * 获取 Memory 工具统计总数
   */
  getMemoryStatsCount(): number {
    return this.memoryTools.length;
  }

  /**
   * 按 Agent 统计 Token 使用
   */
  getTokenStatsByAgent(
    agentId?: string
  ): Record<string, { total: number; prompt: number; completion: number; cost: number }> {
    const filtered = agentId ? this.tokenUsages.filter((t) => t.agentId === agentId) : this.tokenUsages;

    const stats: Record<string, { total: number; prompt: number; completion: number; cost: number }> = {};
    for (const token of filtered) {
      const key = token.agentId || 'unknown';
      if (!stats[key]) {
        stats[key] = { total: 0, prompt: 0, completion: 0, cost: 0 };
      }
      stats[key].total += token.totalTokens;
      stats[key].prompt += token.promptTokens;
      stats[key].completion += token.completionTokens;
      stats[key].cost += token.cost || 0;
    }
    return stats;
  }

  /**
   * 按 Session 统计 Token 使用
   */
  getTokenStatsBySession(
    sessionId?: string
  ): Record<string, { total: number; prompt: number; completion: number; cost: number }> {
    const filtered = sessionId ? this.tokenUsages.filter((t) => t.sessionId === sessionId) : this.tokenUsages;

    const stats: Record<string, { total: number; prompt: number; completion: number; cost: number }> = {};
    for (const token of filtered) {
      const key = token.sessionId;
      if (!stats[key]) {
        stats[key] = { total: 0, prompt: 0, completion: 0, cost: 0 };
      }
      stats[key].total += token.totalTokens;
      stats[key].prompt += token.promptTokens;
      stats[key].completion += token.completionTokens;
      stats[key].cost += token.cost || 0;
    }
    return stats;
  }

  /**
   * 获取 Token 使用概览
   */
  getTokenStatsOverview(): {
    total: { total: number; prompt: number; completion: number; cost: number };
    byModel: Record<string, { total: number; prompt: number; completion: number; cost: number }>;
  } {
    const total = { total: 0, prompt: 0, completion: 0, cost: 0 };
    const byModel: Record<string, { total: number; prompt: number; completion: number; cost: number }> = {};

    for (const token of this.tokenUsages) {
      total.total += token.totalTokens;
      total.prompt += token.promptTokens;
      total.completion += token.completionTokens;
      total.cost += token.cost || 0;

      if (!byModel[token.model]) {
        byModel[token.model] = { total: 0, prompt: 0, completion: 0, cost: 0 };
      }
      byModel[token.model].total += token.totalTokens;
      byModel[token.model].prompt += token.promptTokens;
      byModel[token.model].completion += token.completionTokens;
      byModel[token.model].cost += token.cost || 0;
    }

    return { total, byModel };
  }

  /**
   * 获取系统健康状态
   */
  getSystemHealth(): {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    metrics: {
      totalRequests: number;
      successRate: number;
      avgResponseTime: number;
      errorRate: number;
      memoryUsage: NodeJS.MemoryUsage;
    };
  } {
    const recentRequests = this.requests.slice(-100);
    const successCount = recentRequests.filter((r) => r.success).length;
    const successRate = recentRequests.length > 0 ? successCount / recentRequests.length : 1;
    const avgResponseTime =
      recentRequests.length > 0 ? recentRequests.reduce((sum, r) => sum + r.duration, 0) / recentRequests.length : 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (successRate < 0.9 || avgResponseTime > 5000) {
      status = 'warning';
    }
    if (successRate < 0.7 || avgResponseTime > 10000) {
      status = 'critical';
    }

    return {
      status,
      uptime: process.uptime(),
      metrics: {
        totalRequests: this.requests.length,
        successRate,
        avgResponseTime,
        errorRate: 1 - successRate,
        memoryUsage: process.memoryUsage()
      }
    };
  }

  private parseTimeRange(options?: { since?: Date; until?: Date }): { start: Date; end: Date } {
    const now = new Date();
    const start = options?.since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const end = options?.until ?? now;
    return { start, end };
  }

  /**
   * 按时间过滤记录
   */
  private filterByTime<T extends { timestamp: string; sessionId: string }>(
    records: T[],
    start: Date,
    end: Date,
    sessionId?: string
  ): T[] {
    return records.filter((r) => {
      const ts = new Date(r.timestamp);
      const inRange = ts >= start && ts <= end;
      const matchSession = !sessionId || r.sessionId === sessionId;
      return inRange && matchSession;
    });
  }

  /**
   * 修剪并保存
   */
  private async trimAndSave<T>(type: string, records: T[], filePath: string): Promise<void> {
    if (records.length > this.maxRecordsPerFile) {
      records.splice(0, records.length - this.maxRecordsPerFile);
      log.debug(`[MetricsCollector] 修剪 ${type} 记录到 ${this.maxRecordsPerFile} 条`);
    }

    try {
      await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (error) {
      log.error(`[MetricsCollector] 保存 ${type} 记录失败`, error);
    }
  }

  /**
   * 加载所有指标
   */
  private async loadAll(): Promise<void> {
    this.tokenUsages = await this.loadFile<TokenUsageMetric>(this.tokenUsageFile);
    this.requests = await this.loadFile<RequestMetric>(this.requestsFile);
    this.compressions = await this.loadFile<CompressionMetric>(this.compressionsFile);
    this.memoryTools = await this.loadFile<MemoryToolMetric>(this.memoryToolFile);

    log.debug(
      `[MetricsCollector] 加载历史数据: tokens=${this.tokenUsages.length}, requests=${this.requests.length}, compressions=${this.compressions.length}, memory=${this.memoryTools.length}`
    );
  }

  /**
   * 加载单个文件
   */
  private async loadFile<T>(filePath: string): Promise<T[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

// 单例实例
let instance: MetricsCollector | null = null;

/**
 * 初始化 MetricsCollector
 */
export async function initializeMetricsCollector(): Promise<void> {
  if (instance) return;

  instance = new MetricsCollector();
  await instance.initialize();
}

/**
 * 获取 MetricsCollector 实例
 */
export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    throw new Error('MetricsCollector 未初始化，请先调用 initializeMetricsCollector()');
  }
  return instance;
}
