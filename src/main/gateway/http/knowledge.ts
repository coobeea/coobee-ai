import type Router from '@koa/router';
import type { Context } from 'koa';
import { KnowledgeStore } from '@main/knowledge/KnowledgeStore';

function getStore(): KnowledgeStore {
  return KnowledgeStore.getInstance();
}

export function registerKnowledgeRoutes(router: Router): void {
  router.get('/knowledge/list', (ctx: Context) => {
    ctx.body = { success: true, data: getStore().list() };
  });

  router.get('/knowledge/:id', (ctx: Context) => {
    const meta = getStore().get(ctx.params.id);
    if (!meta) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Knowledge base not found' };
      return;
    }
    ctx.body = { success: true, data: meta };
  });

  router.get('/knowledge/:id/index', (ctx: Context) => {
    const content = getStore().getIndex(ctx.params.id);
    if (content === null) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'index.md not found' };
      return;
    }
    ctx.body = { success: true, data: { content } };
  });

  router.get('/knowledge/:id/tree', (ctx: Context) => {
    const tree = getStore().listTree(ctx.params.id);
    ctx.body = { success: true, data: tree };
  });

  router.get('/knowledge/:id/read', (ctx: Context) => {
    const filePath = ctx.query.path as string;
    if (!filePath) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'path query parameter is required' };
      return;
    }
    const content = getStore().readFile(ctx.params.id, filePath);
    if (content === null) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'File not found' };
      return;
    }
    ctx.body = { success: true, data: { path: filePath, content } };
  });

  router.delete('/knowledge/:id', (ctx: Context) => {
    const deleted = getStore().delete(ctx.params.id);
    ctx.body = { success: deleted };
  });
}
