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

import * as fs from 'fs';
import * as path from 'path';
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
    const { title, agentId, agentType } = (body ?? {}) as {
      title?: string;
      agentId?: string;
      agentType?: 'agent' | 'orchestrator' | 'swarm' | 'discussion';
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
        agentType: agentType || 'agent',
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

  // ==================== HISTORY ====================

  router.get('/threads/:id/history', async (ctx) => {
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

      const { Env } = await import('@main/common/env');
      const workspace = path.join(Env.paths.workspacesDir, threadId);

      // 1. 读取 events/events.jsonl（流式事件）
      const eventsFile = path.join(workspace, 'events', 'events.jsonl');
      let events: Record<string, unknown>[] = [];
      if (fs.existsSync(eventsFile)) {
        const content = await fs.promises.readFile(eventsFile, 'utf-8');
        events = content
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      }

      // 2. 提取用户消息（从 session 文件）
      const userMessages = await extractUserMessages(workspace, thread.sessionId);

      ctx.body = { events, userMessages };
    } catch (err) {
      log.error(`[threads.history] Error (${threadId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[threads] HTTP routes registered');
}

/**
 * 从 workspace 的 session 文件中提取用户消息
 *
 * 支持两种格式：
 *   - SessionItem (messages.jsonl): { seq, type, item: { role, content }, ts }
 *   - 时间戳 JSONL: { type: "message", message: { role, content, timestamp } }
 */
async function extractUserMessages(
  workspace: string,
  sessionId: string
): Promise<{ content: string; timestamp: number }[]> {
  const sessionDir = path.join(workspace, 'sessions', sessionId);
  if (!fs.existsSync(sessionDir)) return [];

  const userMsgs: { content: string; timestamp: number }[] = [];

  const files = await fs.promises.readdir(sessionDir);
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = path.join(sessionDir, file);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        // SessionItem 格式 (messages.jsonl)
        if (typeof parsed.seq === 'number' && typeof parsed.type === 'string') {
          const item = parsed.item as Record<string, unknown> | undefined;
          if (item?.role === 'user') {
            const text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
            userMsgs.push({ content: text, timestamp: (parsed.ts as number) || 0 });
          }
          continue;
        }

        // 时间戳 JSONL 格式
        if (parsed.type === 'message') {
          const msg = parsed.message as Record<string, unknown> | undefined;
          if (msg?.role === 'user') {
            let text: string;
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = (msg.content as { type: string; text?: string }[])
                .filter((b) => b.type === 'text' && b.text)
                .map((b) => b.text!)
                .join('\n');
            } else {
              text = JSON.stringify(msg.content);
            }
            const ts = parsed.timestamp
              ? typeof parsed.timestamp === 'string'
                ? new Date(parsed.timestamp as string).getTime()
                : (parsed.timestamp as number)
              : (msg.timestamp as number) || 0;
            userMsgs.push({ content: text, timestamp: ts });
          }
        }
      }
    } catch (err) {
      log.warn(`[threads.history] Failed to parse session file ${file}:`, err);
    }
  }

  return userMsgs.sort((a, b) => a.timestamp - b.timestamp);
}
