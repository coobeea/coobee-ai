/**
 * brain-metrics.ts — Brain 使用监控 HTTP API
 *
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET /gateway/brain-metrics/stats           — 获取统计数据
 *   GET /gateway/brain-metrics/records         — 获取调用记录
 *   POST /gateway/brain-metrics/clear          — 清空记录
 */

import type Router from '@koa/router';
import type { Context } from 'koa';
import { createLogger } from '@main/common/logger';
import { getBrainMetrics } from '@main/ai/metrics/BrainMetrics';

const log = createLogger('gateway-http-brain-metrics');

export function registerBrainMetricsRoutes(router: Router): void {
  /**
   * GET /gateway/brain-metrics/stats
   * 获取统计数据
   */
  router.get('/brain-metrics/stats', async (ctx: Context) => {
    try {
      const { agentId, since } = ctx.query;

      const metrics = getBrainMetrics();
      const stats = metrics.getStats({
        agentId: agentId as string | undefined,
        since: since ? new Date(since as string) : undefined
      });

      ctx.status = 200;
      ctx.body = { stats };
    } catch (err) {
      log.error('[brain-metrics] GET /stats 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * GET /gateway/brain-metrics/records
   * 获取调用记录
   */
  router.get('/brain-metrics/records', async (ctx: Context) => {
    try {
      const { limit, offset, agentId, toolType } = ctx.query;

      const metrics = getBrainMetrics();
      const records = metrics.getRecords({
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        agentId: agentId as string | undefined,
        toolType: toolType as 'search' | 'publish' | undefined
      });

      ctx.status = 200;
      ctx.body = { records };
    } catch (err) {
      log.error('[brain-metrics] GET /records 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * POST /gateway/brain-metrics/clear
   * 清空记录
   */
  router.post('/brain-metrics/clear', async (ctx: Context) => {
    try {
      const metrics = getBrainMetrics();
      await metrics.clearRecords();

      ctx.status = 200;
      ctx.body = { success: true };
    } catch (err) {
      log.error('[brain-metrics] POST /clear 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  log.info('[brain-metrics] HTTP routes registered');
}
