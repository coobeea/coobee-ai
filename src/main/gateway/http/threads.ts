/**
 * Threads HTTP 路由
 *
 * 为会话线程 CRUD 操作注册标准 REST HTTP 端点。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/threads           — 列出所有线程（支持 ?agentId=xx&status=xx 过滤）
 *   GET    /gateway/threads/:id       — 获取线程详情
 *   POST   /gateway/threads           — 创建线程
 *   PATCH  /gateway/threads/:id       — 更新线程（部分更新）
 *   DELETE /gateway/threads/:id       — 删除线程
 *
 * 设计：
 *   - 直接调用 ThreadStore
 *   - 标准 JSON 请求/响应，前端用 fetch 即可
 *   - 错误统一返回 { error: string } + 对应 HTTP 状态码
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { ThreadStore } from '@main/ai/threads/ThreadStore';

const log = createLogger('gateway-http-threads');

export function registerThreadRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/threads', async (ctx) => {
    try {
      const store = await ThreadStore.getInstance();
      const agentId = ctx.query.agentId as string | undefined;
      const status = ctx.query.status as string | undefined;
      const threads = await store.list({ agentId, status });
      ctx.body = { threads };
    } catch (err) {
      log.error('[threads.list] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== GET ====================

  router.get('/threads/:id', async (ctx) => {
    const threadId = ctx.params.id;
    if (!threadId) {
      ctx.status = 400;
      ctx.body = { error: 'threadId is required' };
      return;
    }

    try {
      const store = await ThreadStore.getInstance();
      const thread = await store.get(threadId);
      if (!thread) {
        ctx.status = 404;
        ctx.body = { error: `Thread "${threadId}" not found` };
        return;
      }
      ctx.body = { thread };
    } catch (err) {
      log.error(`[threads.get] Error (${threadId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== CREATE ====================

  router.post('/threads', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const { title, agentId } = (body ?? {}) as {
      title?: string;
      agentId?: string;
    };

    if (!title || !agentId) {
      ctx.status = 400;
      ctx.body = { error: 'title and agentId are required' };
      return;
    }

    try {
      const store = await ThreadStore.getInstance();
      const thread = await store.create({
        title,
        agentId,
        metadata: (body?.metadata as Record<string, unknown>) ?? undefined
      });
      ctx.status = 201;
      ctx.body = { thread };
    } catch (err) {
      log.error('[threads.create] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== UPDATE ====================

  router.patch('/threads/:id', async (ctx) => {
    const threadId = ctx.params.id;
    if (!threadId) {
      ctx.status = 400;
      ctx.body = { error: 'threadId is required' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    if (!body || Object.keys(body).length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'Request body is empty' };
      return;
    }

    try {
      const store = await ThreadStore.getInstance();
      const thread = await store.update(threadId, {
        title: body.title as string | undefined,
        status: body.status as 'active' | 'archived' | 'deleted' | undefined,
        messageCount: body.messageCount as number | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined
      });
      if (!thread) {
        ctx.status = 404;
        ctx.body = { error: `Thread "${threadId}" not found` };
        return;
      }
      ctx.body = { thread };
    } catch (err) {
      log.error(`[threads.update] Error (${threadId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== DELETE ====================

  router.delete('/threads/:id', async (ctx) => {
    const threadId = ctx.params.id;
    if (!threadId) {
      ctx.status = 400;
      ctx.body = { error: 'threadId is required' };
      return;
    }

    try {
      const store = await ThreadStore.getInstance();
      const deleted = await store.delete(threadId);
      if (!deleted) {
        ctx.status = 404;
        ctx.body = { error: `Thread "${threadId}" not found` };
        return;
      }
      ctx.body = { threadId, deleted: true };
    } catch (err) {
      log.error(`[threads.delete] Error (${threadId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[threads] HTTP routes registered');
}
