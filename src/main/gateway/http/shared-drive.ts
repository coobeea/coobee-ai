/**
 * SharedDrive HTTP 路由
 *
 * 多智能体共享网盘的 HTTP API，采用酒馆模式（Gateway REST + Skill 对接）。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/shared-drive/entries              — 查询条目列表
 *   GET    /gateway/shared-drive/entries/:id          — 获取条目详情
 *   POST   /gateway/shared-drive/entries              — 创建新条目
 *   PUT    /gateway/shared-drive/entries/:id          — 更新条目
 *   DELETE /gateway/shared-drive/entries/:id          — 删除条目
 *   POST   /gateway/shared-drive/entries/:id/files    — 上传文件
 *   GET    /gateway/shared-drive/entries/:id/files/:filename — 下载文件
 *   GET    /gateway/shared-drive/search               — 搜索
 *   GET    /gateway/shared-drive/stats                — 统计信息
 *
 * 存储层委托给 SharedDriveStore。
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { SharedDriveStore } from '@main/ai/shared-drive/SharedDriveStore';

const log = createLogger('gateway-http-shared-drive');

export function registerSharedDriveRoutes(router: Router): void {
  // ==================== 条目 CRUD ====================

  router.get('/shared-drive/entries', async (ctx) => {
    try {
      const store = await SharedDriveStore.getInstance();
      const { agentId, date, keyword, limit, offset } = ctx.query as Record<string, string | undefined>;
      const entries = await store.list({
        agentId,
        date,
        keyword,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined
      });
      ctx.body = { entries };
    } catch (err) {
      log.error('Failed to list entries:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to list entries' };
    }
  });

  router.get('/shared-drive/entries/:id', async (ctx) => {
    const entryId = ctx.params.id;
    if (!entryId) {
      ctx.status = 400;
      ctx.body = { error: 'Entry ID is required' };
      return;
    }

    try {
      const store = await SharedDriveStore.getInstance();
      const result = await store.getEntry(entryId);
      if (!result) {
        ctx.status = 404;
        ctx.body = { error: 'Entry not found' };
        return;
      }
      ctx.body = result;
    } catch (err) {
      log.error(`Failed to get entry ${entryId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to get entry' };
    }
  });

  router.post('/shared-drive/entries', async (ctx) => {
    try {
      const body = ctx.request.body as Record<string, unknown>;
      const { agentId, topic, content, tags, summary, date } = body;

      if (!agentId || typeof agentId !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'agentId is required' };
        return;
      }
      if (!topic || typeof topic !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'topic is required' };
        return;
      }
      if (!content || typeof content !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'content is required' };
        return;
      }

      const store = await SharedDriveStore.getInstance();
      const entry = await store.createEntry({
        agentId,
        topic,
        content,
        tags: Array.isArray(tags) ? (tags as string[]) : undefined,
        summary: typeof summary === 'string' ? summary : undefined,
        date: typeof date === 'string' ? date : undefined
      });

      ctx.status = 201;
      ctx.body = { entry };

      eventBus.emit('shared-drive:entry-created', {
        entryId: entry.id,
        agentId: entry.agentId,
        topic: entry.topic,
        date: entry.date,
        tags: entry.tags,
        summary: entry.summary,
        path: entry.path,
        timestamp: Date.now()
      });
    } catch (err) {
      log.error('Failed to create entry:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to create entry' };
    }
  });

  router.put('/shared-drive/entries/:id', async (ctx) => {
    const entryId = ctx.params.id;
    if (!entryId) {
      ctx.status = 400;
      ctx.body = { error: 'Entry ID is required' };
      return;
    }

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const store = await SharedDriveStore.getInstance();
      const updated = await store.updateEntry(entryId, {
        content: typeof body.content === 'string' ? body.content : undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined
      });

      if (!updated) {
        ctx.status = 404;
        ctx.body = { error: 'Entry not found' };
        return;
      }
      ctx.body = { entry: updated };
    } catch (err) {
      log.error(`Failed to update entry ${entryId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to update entry' };
    }
  });

  router.delete('/shared-drive/entries/:id', async (ctx) => {
    const entryId = ctx.params.id;
    if (!entryId) {
      ctx.status = 400;
      ctx.body = { error: 'Entry ID is required' };
      return;
    }

    try {
      const store = await SharedDriveStore.getInstance();
      const deleted = await store.deleteEntry(entryId);
      if (!deleted) {
        ctx.status = 404;
        ctx.body = { error: 'Entry not found' };
        return;
      }
      ctx.body = { ok: true };
    } catch (err) {
      log.error(`Failed to delete entry ${entryId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to delete entry' };
    }
  });

  // ==================== 文件操作 ====================

  router.post('/shared-drive/entries/:id/files', async (ctx) => {
    const entryId = ctx.params.id;
    if (!entryId) {
      ctx.status = 400;
      ctx.body = { error: 'Entry ID is required' };
      return;
    }

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const filename = body.filename as string;
      const content = body.content as string;

      if (!filename || !content) {
        ctx.status = 400;
        ctx.body = { error: 'filename and content are required' };
        return;
      }

      const store = await SharedDriveStore.getInstance();
      const ok = await store.addFile(entryId, filename, content);
      if (!ok) {
        ctx.status = 404;
        ctx.body = { error: 'Entry not found' };
        return;
      }
      ctx.status = 201;
      ctx.body = { ok: true };
    } catch (err) {
      log.error(`Failed to add file to entry ${entryId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to add file' };
    }
  });

  router.get('/shared-drive/entries/:id/files/:filename', async (ctx) => {
    const { id: entryId, filename } = ctx.params;
    if (!entryId || !filename) {
      ctx.status = 400;
      ctx.body = { error: 'Entry ID and filename are required' };
      return;
    }

    try {
      const store = await SharedDriveStore.getInstance();
      const file = await store.getFile(entryId, filename);
      if (!file) {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = file;
    } catch (err) {
      log.error(`Failed to get file ${filename} from entry ${entryId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to get file' };
    }
  });

  // ==================== 搜索和统计 ====================

  router.get('/shared-drive/search', async (ctx) => {
    const keyword = ctx.query.keyword as string;
    if (!keyword) {
      ctx.status = 400;
      ctx.body = { error: 'keyword query parameter is required' };
      return;
    }

    try {
      const store = await SharedDriveStore.getInstance();
      const entries = await store.search(keyword);
      ctx.body = { entries };
    } catch (err) {
      log.error('Failed to search:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to search' };
    }
  });

  router.get('/shared-drive/stats', async (ctx) => {
    try {
      const store = await SharedDriveStore.getInstance();
      const stats = await store.getStats();
      ctx.body = stats;
    } catch (err) {
      log.error('Failed to get stats:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to get stats' };
    }
  });

  log.info('[SharedDrive] HTTP routes registered');
}
