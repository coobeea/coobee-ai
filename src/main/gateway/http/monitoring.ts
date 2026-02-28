/**
 * 系统可观测性监控 HTTP API
 * 提供压缩、Memory、Token 使用情况的查询接口
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'koa';
import type Router from '@koa/router';
import { Env } from '@main/common/env';
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

  // ========== 记忆文件查询 API ==========

  // GET /monitoring/memory-files - 列出记忆文件（全局 + 工作空间）
  router.get('/monitoring/memory-files', async (ctx: Context) => {
    try {
      const files: Array<{ name: string; path: string; size: number; mtime: string; scope: string }> = [];

      // 全局记忆目录
      const globalMemDir = Env.paths.memoryDir;
      if (fs.existsSync(globalMemDir)) {
        scanMemoryDir(globalMemDir, 'global', files);
      }

      // 扫描所有工作空间的记忆
      const workspacesDir = Env.paths.workspacesDir;
      if (fs.existsSync(workspacesDir)) {
        for (const wsName of fs.readdirSync(workspacesDir)) {
          const wsMemDir = path.join(workspacesDir, wsName, 'memory');
          const wsMainMemory = path.join(workspacesDir, wsName, 'MEMORY.md');
          if (fs.existsSync(wsMainMemory)) {
            const stat = fs.statSync(wsMainMemory);
            files.push({
              name: 'MEMORY.md',
              path: wsMainMemory,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              scope: `workspace:${wsName}`
            });
          }
          if (fs.existsSync(wsMemDir)) {
            scanMemoryDir(wsMemDir, `workspace:${wsName}`, files);
          }
        }
      }

      files.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
      ctx.body = { files, total: files.length };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // GET /monitoring/memory-content - 读取指定记忆文件内容
  router.get('/monitoring/memory-content', async (ctx: Context) => {
    try {
      const filePath = ctx.query.file as string;
      if (!filePath) {
        ctx.status = 400;
        ctx.body = { error: 'Missing file parameter' };
        return;
      }

      // 安全检查：只允许读取 .home 下的记忆文件
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(Env.paths.userHome)) {
        ctx.status = 403;
        ctx.body = { error: 'Access denied: file outside home directory' };
        return;
      }

      if (!fs.existsSync(resolved)) {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      const stat = fs.statSync(resolved);
      ctx.body = {
        file: path.basename(resolved),
        path: resolved,
        content,
        size: stat.size,
        mtime: stat.mtime.toISOString()
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

/** 递归扫描记忆目录中的 .md 文件 */
function scanMemoryDir(
  dir: string,
  scope: string,
  result: Array<{ name: string; path: string; size: number; mtime: string; scope: string }>
): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && /\.(md|txt|json|yaml|yml)$/i.test(entry.name)) {
        const stat = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          scope
        });
      } else if (entry.isDirectory()) {
        scanMemoryDir(fullPath, scope, result);
      }
    }
  } catch {
    // 静默处理权限或读取错误
  }
}
