/**
 * 终端管理 HTTP API
 *
 * 提供 PTY 终端的创建、输入、调整大小、销毁和列表查询接口。
 * 终端输出通过 TerminalBridge 事件桥接实时推送到 WebSocket。
 *
 * 路由（均挂在 /gateway 前缀下）：
 *   POST   /terminals          — 创建终端
 *   GET    /terminals          — 列出所有终端
 *   POST   /terminals/:id/input  — 向终端写入数据
 *   POST   /terminals/:id/resize — 调整终端大小
 *   DELETE /terminals/:id      — 销毁终端
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { getPtyManager } from '@main/terminal/PtyManager';

export function registerTerminalRoutes(router: Router): void {
  const mgr = getPtyManager();

  router.post('/terminals', async (ctx: Context) => {
    try {
      const body = ctx.request.body as Record<string, unknown> | undefined;
      const info = mgr.create({
        cwd: (body?.cwd as string) || undefined,
        cols: (body?.cols as number) || undefined,
        rows: (body?.rows as number) || undefined,
        shell: (body?.shell as string) || undefined
      });
      ctx.body = info;
    } catch (error) {
      ctx.status = 400;
      ctx.body = { error: error instanceof Error ? error.message : String(error) };
    }
  });

  router.get('/terminals', async (ctx: Context) => {
    ctx.body = { terminals: mgr.list() };
  });

  router.post('/terminals/:id/input', async (ctx: Context) => {
    const terminalId = ctx.params.id;
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const data = body?.data as string;
    if (!data && data !== '') {
      ctx.status = 400;
      ctx.body = { error: 'Missing data field' };
      return;
    }
    const ok = mgr.write(terminalId, data);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { error: 'Terminal not found' };
      return;
    }
    ctx.body = { ok: true };
  });

  router.post('/terminals/:id/resize', async (ctx: Context) => {
    const terminalId = ctx.params.id;
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const cols = body?.cols as number;
    const rows = body?.rows as number;
    if (!cols || !rows) {
      ctx.status = 400;
      ctx.body = { error: 'Missing cols or rows' };
      return;
    }
    const ok = mgr.resize(terminalId, cols, rows);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { error: 'Terminal not found' };
      return;
    }
    ctx.body = { ok: true };
  });

  router.delete('/terminals/:id', async (ctx: Context) => {
    const terminalId = ctx.params.id;
    const ok = mgr.destroy(terminalId);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { error: 'Terminal not found' };
      return;
    }
    ctx.body = { ok: true };
  });
}
