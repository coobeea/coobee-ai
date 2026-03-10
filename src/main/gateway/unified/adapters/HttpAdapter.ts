/**
 * HTTP Adapter - REST API 适配器
 *
 * 将 Koa HTTP 路由适配到统一协议
 */

import type { Context, Next } from 'koa';
import { log } from '@main/common/logger';
import type { UnifiedHandler, UnifiedContext } from '../types';

/**
 * 创建 Koa 中间件，将请求适配到 UnifiedHandler
 */
export function createHttpMiddleware(handler: UnifiedHandler) {
  return async (ctx: Context, next: Next) => {
    const startTime = Date.now();

    try {
      // 构建统一上下文
      const context: UnifiedContext = {
        type: 'http',
        client: {
          connectionId: `http_${ctx.ip}_${Date.now()}`,
          method: ctx.method,
          path: ctx.path,
          headers: ctx.headers
        }
      };

      // 获取请求负载
      const payload = ctx.method === 'GET' || ctx.method === 'DELETE' ? ctx.query : ctx.request.body;

      // 调用处理器
      const result = await handler(payload, context);

      // 设置响应
      ctx.status = 200;
      ctx.body = {
        success: true,
        data: result
      };

      const duration = Date.now() - startTime;
      log.debug(`[HttpAdapter] ${ctx.method} ${ctx.path} - 200 (${duration}ms)`);

      await next();
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error(`[HttpAdapter] ${ctx.method} ${ctx.path} 失败 (${duration}ms)`, error);

      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  };
}

/**
 * 将 UnifiedHandler 包装为 Koa 路由处理函数
 */
export function wrapAsKoaHandler(handler: UnifiedHandler): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => {
    const context: UnifiedContext = {
      type: 'http',
      client: {
        connectionId: `http_${ctx.ip}_${Date.now()}`,
        method: ctx.method,
        path: ctx.path
      }
    };

    const payload = ctx.method === 'GET' || ctx.method === 'DELETE' ? ctx.query : ctx.request.body;

    try {
      const result = await handler(payload, context);
      ctx.status = 200;
      ctx.body = { success: true, data: result };
    } catch (error) {
      log.error('[HttpAdapter] Handler 失败', error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: {
          code: 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  };
}
