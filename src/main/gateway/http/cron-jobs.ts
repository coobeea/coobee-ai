/**
 * cron-jobs.ts — 定时任务 HTTP API
 *
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/cron-jobs           — 获取所有定时任务列表
 *   GET    /gateway/cron-jobs/:id       — 获取单个定时任务
 *   POST   /gateway/cron-jobs           — 创建定时任务
 *   POST   /gateway/cron-jobs/parse     — AI 解析自然语言为定时任务参数
 *   PATCH  /gateway/cron-jobs/:id       — 更新定时任务
 *   DELETE /gateway/cron-jobs/:id       — 删除定时任务
 */

import type Router from '@koa/router';
import type { Context } from 'koa';
import { createLogger } from '@main/common/logger';
import { getCronJobStore, getCronScheduler, type CreateCronJobParams, type UpdateCronJobParams } from '@main/ai/cron';
import { LLMService } from '@main/ai/provider/LLMService';
import { agentExecutor } from '@main/ai/AgentExecutor';

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
   * POST /gateway/cron-jobs/parse
   * AI 解析自然语言为定时任务参数
   */
  router.post('/cron-jobs/parse', async (ctx: Context) => {
    try {
      const body = ctx.request.body as { input?: string } | undefined;
      if (!body?.input?.trim()) {
        ctx.status = 400;
        ctx.body = { error: '请输入任务描述' };
        return;
      }

      const llmService = new LLMService(agentExecutor);

      const result = await llmService.chat({
        messages: [
          {
            role: 'system',
            content: `你是一个定时任务解析助手。用户会用自然语言描述一个定时任务，你需要解析为结构化参数。
必须严格输出 JSON 对象，不要有其他文字。字段如下：
- name: 简短的任务名称（4-10字）
- description: 任务详细描述
- cronExpression: 标准 cron 表达式（5位：分 时 日 月 周）
- task: 执行的具体指令（智能体收到的提示词）
- cronHumanReadable: cron 表达式的中文解释

示例：
输入："每天早上9点帮我汇总项目进度"
输出：{"name":"每日进度汇总","description":"每天早上自动汇总项目进度并生成报告","cronExpression":"0 9 * * *","task":"请汇总今天的项目进度，整理成报告格式输出","cronHumanReadable":"每天上午 9:00"}

输入："每周一下午3点做代码审查"
输出：{"name":"周一代码审查","description":"每周一下午定期进行代码审查","cronExpression":"0 15 * * 1","task":"请对本周的代码变更进行全面审查，输出审查报告","cronHumanReadable":"每周一下午 3:00"}

当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
          },
          { role: 'user', content: body.input.trim() }
        ],
        temperature: 0.3
      });

      const jsonStr = result.content
        .replace(/```json?\s*\n?/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      const parsed = JSON.parse(jsonStr);

      ctx.status = 200;
      ctx.body = { parsed };
    } catch (err) {
      log.error('[cron-jobs] POST /parse 失败:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : 'AI 解析失败' };
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
