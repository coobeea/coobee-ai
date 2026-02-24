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
  router.get('/monitoring/compression', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const { limit = 50, offset = 0 } = ctx.query;
      const compressionEvents = metricsCollector.getCompressionEvents(Number(limit), Number(offset));

      ctx.body = {
        success: true,
        data: {
          events: compressionEvents,
          total: metricsCollector.getCompressionEventsCount()
        }
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  });

  // GET /monitoring/memory - 获取 Memory 工具使用统计
  router.get('/monitoring/memory', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const { limit = 50, offset = 0 } = ctx.query;
      const memoryStats = metricsCollector.getMemoryStats(Number(limit), Number(offset));

      ctx.body = {
        success: true,
        data: {
          stats: memoryStats,
          total: metricsCollector.getMemoryStatsCount()
        }
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  });

  // GET /monitoring/tokens - 获取 Token 使用统计
  router.get('/monitoring/tokens', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const { agentId, sessionId, groupBy = 'agent' } = ctx.query;

      let tokenStats;
      if (groupBy === 'agent') {
        tokenStats = metricsCollector.getTokenStatsByAgent(agentId as string | undefined);
      } else if (groupBy === 'session') {
        tokenStats = metricsCollector.getTokenStatsBySession(sessionId as string | undefined);
      } else {
        tokenStats = metricsCollector.getTokenStatsOverview();
      }

      ctx.body = {
        success: true,
        data: tokenStats
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  });

  // GET /monitoring/system - 获取系统健康状态
  router.get('/monitoring/system', async (ctx: Context) => {
    try {
      const metricsCollector = getMetricsCollector();
      const systemHealth = metricsCollector.getSystemHealth();

      ctx.body = {
        success: true,
        data: systemHealth
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  });
}
