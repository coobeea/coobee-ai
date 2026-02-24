/**
 * 系统可观测性监控 HTTP API
 * 提供压缩、Memory、Token 使用情况的查询接口
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { getMetricsCollector } from '@main/metrics/MetricsCollector';

/**
 * 注册可观测性监控路由
 */
export function registerMonitoringRoutes(router: Router): void {
  // GET /monitoring/compression - 获取会话压缩记录
  // Response: { records: CompressionMetric[], summary: { total, avgCompressionRatio, totalTokensSaved } }
  router.get('/monitoring/compression', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const { limit = 50, offset = 0 } = ctx.query;
      const records = metricsCollector.getCompressionEvents(Number(limit), Number(offset));
      const all = metricsCollector.getCompressionEvents(10000, 0);

      const totalTokensSaved = all.reduce((sum, r) => sum + Math.max(0, r.beforeTokens - r.afterTokens), 0);
      const avgCompressionRatio = all.length > 0 ? all.reduce((sum, r) => sum + r.compressionRatio, 0) / all.length : 0;

      ctx.body = {
        records,
        summary: {
          total: metricsCollector.getCompressionEventsCount(),
          avgCompressionRatio,
          totalTokensSaved
        }
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // GET /monitoring/memory - 获取 Memory 工具使用统计
  // Response: { records: MemoryToolMetric[], summary: { total, byOperation, successRate } }
  router.get('/monitoring/memory', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const { limit = 50, offset = 0 } = ctx.query;
      const records = metricsCollector.getMemoryStats(Number(limit), Number(offset));
      const all = metricsCollector.getMemoryStats(10000, 0);

      const byOperation: Record<string, number> = { store: 0, retrieve: 0, search: 0 };
      let successCount = 0;
      for (const r of all) {
        byOperation[r.operation] = (byOperation[r.operation] || 0) + 1;
        if (r.success) successCount++;
      }
      const successRate = all.length > 0 ? successCount / all.length : 0;

      ctx.body = {
        records,
        summary: {
          total: metricsCollector.getMemoryStatsCount(),
          byOperation,
          successRate
        }
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // GET /monitoring/tokens - 获取 Token 使用统计
  // Response: { records: TokenUsageMetric[], summary: { total, prompt, completion, cost }, byModel }
  router.get('/monitoring/tokens', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const overview = metricsCollector.getTokenStatsOverview();
      const byAgent = metricsCollector.getTokenStatsByAgent();

      ctx.body = {
        records: [],
        summary: overview.total,
        byModel: overview.byModel,
        byAgent
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // GET /monitoring/system - 获取系统健康状态
  router.get('/monitoring/system', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      ctx.body = metricsCollector.getSystemHealth();
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
