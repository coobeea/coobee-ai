/**
 * metrics.ts — 系统指标 HTTP API
 *
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET /gateway/metrics/aggregated          — 获取聚合统计
 *   GET /gateway/metrics/token-usage         — 获取 Token 使用记录
 *   GET /gateway/metrics/requests            — 获取请求记录
 *   GET /gateway/metrics/compressions        — 获取压缩事件记录
 *   GET /gateway/metrics/memory-tool         — 获取 Memory 工具记录
 */

import type Router from '@koa/router';
import type { Context } from 'koa';
import { createLogger } from '@main/common/logger';
import { getMetricsCollector } from '@main/metrics/MetricsCollector';

const log = createLogger('gateway-http-metrics');

export function registerMetricsRoutes(router: Router): void {
  /**
   * GET /gateway/metrics/aggregated
   * 获取聚合统计
   */
  router.get('/metrics/aggregated', async (ctx: Context) => {
    try {
      const { since, until, sessionId } = ctx.query;

      const collector = getMetricsCollector();
      const metrics = collector.getAggregatedMetrics({
        since: since ? new Date(since as string) : undefined,
        until: until ? new Date(until as string) : undefined,
        sessionId: sessionId as string | undefined
      });

      ctx.status = 200;
      ctx.body = { metrics };
    } catch (err) {
      log.error('[metrics] GET /aggregated 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  log.info('[metrics] HTTP routes registered');
}
