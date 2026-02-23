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
import * as CronJobStore from '@main/storage/CronJobStore';
import type { CreateCronJobParams, UpdateCronJobParams } from '@shared/types/cron';

const log = createLogger('gateway-http-cron-jobs');

export function registerCronJobRoutes(router: Router): void {
  /**
   * GET /gateway/cron-jobs
   * 获取所有定时任务列表
   */
  router.get('/cron-jobs', async (ctx: Context) => {
    try {
      const jobs = await CronJobStore.getAllCronJobs();
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
      const job = await CronJobStore.getCronJob(id);

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

      if (!body || !body.name || !body.description || !body.cronExpression || !body.agentId) {
        ctx.status = 400;
        ctx.body = { error: 'Missing required fields: name, description, cronExpression, agentId' };
        return;
      }

      const job = await CronJobStore.createCronJob(body);

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

      const job = await CronJobStore.updateCronJob(id, body);

      if (!job) {
        ctx.status = 404;
        ctx.body = { error: 'Cron job not found' };
        return;
      }

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
      const success = await CronJobStore.deleteCronJob(id);

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

  log.info('[cron-jobs] HTTP routes registered');
}
