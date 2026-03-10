/**
 * 后台进程管理 HTTP API
 * 提供进程列表查询和输出读取接口
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { ProcessRegistry } from '@main/ai/process/ProcessRegistry';

export function registerProcessRoutes(router: Router): void {
  router.get('/processes', async (ctx: Context) => {
    const registry = ProcessRegistry.getInstance();
    ctx.body = { processes: registry.list() };
  });

  router.get('/processes/:id/output', async (ctx: Context) => {
    const registry = ProcessRegistry.getInstance();
    const processId = ctx.params.id;
    const lastN = ctx.query.lastN ? Number(ctx.query.lastN) : undefined;
    const output = registry.readOutput(processId, lastN);
    if (output === undefined) {
      ctx.status = 404;
      ctx.body = { error: 'Process not found' };
      return;
    }
    ctx.body = { processId, output };
  });
}
