import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

  router.post('/knowledge/create', (ctx: Context) => {
    const { name, description } = ctx.request.body as { name?: string; description?: string };
    if (!name?.trim()) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'name is required' };
      return;
    }
    const meta = getStore().createSimple(name.trim(), description?.trim() ?? '');
    ctx.body = { success: true, data: meta };
  });

  router.post('/knowledge/import', async (ctx: Context) => {
    const { name, description, zipBase64 } = ctx.request.body as {
      name?: string;
      description?: string;
      zipBase64?: string;
    };
    if (!name?.trim() || !zipBase64) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'name and zipBase64 are required' };
      return;
    }

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `kb-import-${Date.now()}.zip`);
    try {
      fs.writeFileSync(tmpFile, Buffer.from(zipBase64, 'base64'));
      const meta = getStore().importFromZip(name.trim(), description?.trim() ?? '', tmpFile);
      ctx.body = { success: true, data: meta };
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
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

  router.put('/knowledge/:id/write', (ctx: Context) => {
    const { path: filePath, content } = ctx.request.body as { path?: string; content?: string };
    if (!filePath) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'path is required' };
      return;
    }
    getStore().writeFile(ctx.params.id, filePath, content ?? '');
    ctx.body = { success: true };
  });

  router.delete('/knowledge/:id/file', (ctx: Context) => {
    const filePath = ctx.query.path as string;
    if (!filePath) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'path query parameter is required' };
      return;
    }
    const deleted = getStore().deleteFile(ctx.params.id, filePath);
    ctx.body = { success: deleted };
  });

  router.post('/knowledge/:id/import', async (ctx: Context) => {
    const { zipBase64 } = ctx.request.body as { zipBase64?: string };
    if (!zipBase64) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'zipBase64 is required' };
      return;
    }
    const tmpFile = path.join(os.tmpdir(), `kb-merge-${Date.now()}.zip`);
    try {
      fs.writeFileSync(tmpFile, Buffer.from(zipBase64, 'base64'));
      const meta = getStore().importIntoExisting(ctx.params.id, tmpFile);
      if (!meta) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Knowledge base not found' };
        return;
      }
      ctx.body = { success: true, data: meta };
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  router.post('/knowledge/:id/reindex', (ctx: Context) => {
    const content = getStore().regenerateIndex(ctx.params.id);
    if (content === null) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Knowledge base not found' };
      return;
    }
    ctx.body = { success: true, data: { content } };
  });

  router.delete('/knowledge/:id', (ctx: Context) => {
    const deleted = getStore().delete(ctx.params.id);
    ctx.body = { success: deleted };
  });
}
