import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Router from '@koa/router';
import type { Context } from 'koa';
import { KnowledgeStore } from '@main/knowledge/KnowledgeStore';
import { KnowledgeBuilder } from '@main/knowledge/KnowledgeBuilder';
import { getAgentExecutor } from '@main/ai/AgentExecutor';

function getStore(): KnowledgeStore {
  return KnowledgeStore.getInstance();
}

function getBuilder(): KnowledgeBuilder {
  return new KnowledgeBuilder(getAgentExecutor());
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

  router.get('/knowledge/:id/index', (ctx: Context) => {
    const content = getStore().getIndex(ctx.params.id);
    if (content === null) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'index.md not found' };
      return;
    }
    ctx.body = { success: true, data: { content } };
  });

  router.get('/knowledge/:id/sources', (ctx: Context) => {
    const sources = getStore().listSources(ctx.params.id);
    ctx.body = { success: true, data: sources };
  });

  /**
   * 创建知识库（仅元数据，不含内容）
   */
  router.post('/knowledge/create', (ctx: Context) => {
    const { name, description } = ctx.request.body as { name?: string; description?: string };
    if (!name?.trim()) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'name is required' };
      return;
    }
    const meta = getStore().create(name.trim(), description?.trim() ?? '');
    ctx.body = { success: true, data: meta };
  });

  /**
   * 上传源材料到知识库
   */
  router.post('/knowledge/:id/upload', async (ctx: Context) => {
    const { fileName, fileBase64 } = ctx.request.body as { fileName?: string; fileBase64?: string };
    if (!fileName || !fileBase64) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'fileName and fileBase64 are required' };
      return;
    }
    const data = Buffer.from(fileBase64, 'base64');
    const material = getStore().addSource(ctx.params.id, fileName, data);
    ctx.body = { success: true, data: material };
  });

  /**
   * 批量上传（ZIP 包整体作为源材料）
   */
  router.post('/knowledge/:id/upload-zip', async (ctx: Context) => {
    const { zipBase64 } = ctx.request.body as { zipBase64?: string };
    if (!zipBase64) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'zipBase64 is required' };
      return;
    }
    const tmpFile = path.join(os.tmpdir(), `kb-src-${Date.now()}.zip`);
    try {
      fs.writeFileSync(tmpFile, Buffer.from(zipBase64, 'base64'));
      const material = getStore().addSource(ctx.params.id, `materials-${Date.now()}.zip`, fs.readFileSync(tmpFile));
      ctx.body = { success: true, data: material };
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  /**
   * 触发构建（AI 训练）
   * 读取 _sources/ 下所有材料，通过 Agent 生成结构化知识库
   */
  router.post('/knowledge/:id/build', async (ctx: Context) => {
    const meta = getStore().get(ctx.params.id);
    if (!meta) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Knowledge base not found' };
      return;
    }
    if (meta.status === 'building') {
      ctx.body = { success: false, error: '知识库正在构建中' };
      return;
    }

    const isExpand = meta.status === 'ready';

    ctx.body = { success: true, data: { message: isExpand ? '开始扩展训练' : '开始构建' } };

    const builder = getBuilder();
    if (isExpand) {
      builder.expand(ctx.params.id).catch(() => {});
    } else {
      builder.build(ctx.params.id).catch(() => {});
    }
  });

  router.delete('/knowledge/:id', (ctx: Context) => {
    const deleted = getStore().delete(ctx.params.id);
    ctx.body = { success: deleted };
  });
}
