/**
 * cron-jobs.ts — 定时任务 HTTP API
 *
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/cron-jobs           — 获取所有定时任务列表
 *   GET    /gateway/cron-jobs/:id       — 获取单个定时任务
 *   POST   /gateway/cron-jobs           — 创建定时任务
 *   PATCH  /gateway/cron-jobs/:id       — 更新定时任务
 *   DELETE /gateway/cron-jobs/:id       — 删除定时任务
 */

import type Router from '@koa/router';
import type { Context } from 'koa';
import { createLogger } from '@main/common/logger';
import { getCronJobStore, getCronScheduler, type CreateCronJobParams, type UpdateCronJobParams } from '@main/ai/cron';

const log = createLogger('gateway-http-cron-jobs');

export function registerCronJobRoutes(router: Router): void {
  /**
   * GET /gateway/cron-jobs
   * 获取所有定时任务列表
   */
  router.get('/cron-jobs', async (ctx: Context) => {
    try {
      const store = getCronJobStore();
      const jobs = await store.list();
      ctx.status = 200;
      ctx.body = { jobs };
    } catch (err) {
      log.error('[cron-jobs] GET / 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * GET /gateway/cron-jobs/:id
   * 获取单个定时任务
   */
  router.get('/cron-jobs/:id', async (ctx: Context) => {
    try {
      const { id } = ctx.params;
      const store = getCronJobStore();
      const job = await store.get(id);

      if (!job) {
        ctx.status = 404;
        ctx.body = { error: 'Cron job not found' };
        return;
      }

      ctx.status = 200;
      ctx.body = { job };
    } catch (err) {
      log.error('[cron-jobs] GET /:id 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * POST /gateway/cron-jobs
   * 创建定时任务
   */
  router.post('/cron-jobs', async (ctx: Context) => {
    try {
      const body = ctx.request.body as CreateCronJobParams | undefined;

      if (!body || !body.name || !body.description || !body.cronExpression || !body.task) {
        ctx.status = 400;
        ctx.body = { error: 'Missing required fields: name, description, cronExpression, task' };
        return;
      }

      const store = getCronJobStore();
      const job = await store.create(body);

      // 如果状态为 active，自动调度
      if (job.status === 'active') {
        const scheduler = getCronScheduler();
        await scheduler.scheduleJob(job);
      }

      ctx.status = 201;
      ctx.body = { job };
    } catch (err) {
      log.error('[cron-jobs] POST / 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * PATCH /gateway/cron-jobs/:id
   * 更新定时任务
   */
  router.patch('/cron-jobs/:id', async (ctx: Context) => {
    try {
      const { id } = ctx.params;
      const body = ctx.request.body as UpdateCronJobParams | undefined;

      if (!body) {
        ctx.status = 400;
        ctx.body = { error: 'Missing request body' };
        return;
      }

      const store = getCronJobStore();
      const job = await store.update(id, body);

      if (!job) {
        ctx.status = 404;
        ctx.body = { error: 'Cron job not found' };
        return;
      }

      // 重新加载调度
      const scheduler = getCronScheduler();
      await scheduler.reloadJob(id);

      ctx.status = 200;
      ctx.body = { job };
    } catch (err) {
      log.error('[cron-jobs] PATCH /:id 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * DELETE /gateway/cron-jobs/:id
   * 删除定时任务
   */
  router.delete('/cron-jobs/:id', async (ctx: Context) => {
    try {
      const { id } = ctx.params;

      // 先取消调度
      const scheduler = getCronScheduler();
      await scheduler.unscheduleJob(id);

      // 再删除数据
      const store = getCronJobStore();
      const success = await store.delete(id);

      if (!success) {
        ctx.status = 404;
        ctx.body = { error: 'Cron job not found' };
        return;
      }

      ctx.status = 204;
    } catch (err) {
      log.error('[cron-jobs] DELETE /:id 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * POST /gateway/cron-jobs/:id/trigger
   * 立即触发定时任务
   */
  router.post('/cron-jobs/:id/trigger', async (ctx: Context) => {
    try {
      const { id } = ctx.params;

      const scheduler = getCronScheduler();
      const success = await scheduler.triggerJob(id);

      if (!success) {
        ctx.status = 404;
        ctx.body = { error: 'Cron job not found' };
        return;
      }

      ctx.status = 200;
      ctx.body = { success: true };
    } catch (err) {
      log.error('[cron-jobs] POST /:id/trigger 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  /**
   * GET /gateway/cron-jobs/:id/executions
   * 获取任务执行历史
   */
  router.get('/cron-jobs/:id/executions', async (ctx: Context) => {
    try {
      const { id } = ctx.params;
      const limit = parseInt(ctx.query.limit as string) || 10;

      const store = getCronJobStore();
      const executions = await store.getExecutions(id, limit);

      ctx.status = 200;
      ctx.body = { executions };
    } catch (err) {
      log.error('[cron-jobs] GET /:id/executions 失败:', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  });

  log.info('[cron-jobs] HTTP routes registered');
}
