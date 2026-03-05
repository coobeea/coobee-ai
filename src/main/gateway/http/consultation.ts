/**
 * Consultation HTTP 路由
 *
 * 提供专家会诊的 HTTP API。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/consultation/sessions        — 获取会诊列表
 *   GET    /gateway/consultation/sessions/:id    — 获取会诊详情
 *   POST   /gateway/consultation/sessions        — 发起会诊
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { ExpertPanel } from '@main/ai/consultation';
import type { ExpertPanelOptions } from '@main/ai/consultation/ExpertPanel';
import type { ConsultationSession } from '@main/ai/consultation/types';

const log = createLogger('gateway-http-consultation');

// 会诊记录存储（简单内存存储，未来可改为数据库）
const sessions = new Map<string, ConsultationSession>();

export function registerConsultationRoutes(router: Router): void {
  // ==================== 会诊会话 CRUD ====================

  router.get('/consultation/sessions', async (ctx) => {
    try {
      const list = Array.from(sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
      ctx.body = { sessions: list };
    } catch (err) {
      log.error('Failed to list consultations:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to load consultations' };
    }
  });

  router.get('/consultation/sessions/:id', async (ctx) => {
    const sessionId = ctx.params.id;
    if (!sessionId) {
      ctx.status = 400;
      ctx.body = { error: 'Session ID is required' };
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      ctx.status = 404;
      ctx.body = { error: 'Consultation not found' };
      return;
    }

    ctx.body = { session };
  });

  router.post('/consultation/sessions', async (ctx) => {
    try {
      const body = ctx.request.body as Partial<ExpertPanelOptions>;

      const question = body.question;
      const experts = body.experts;

      if (!question || !experts || experts.length === 0) {
        ctx.status = 400;
        ctx.body = { error: 'question and experts are required' };
        return;
      }

      const panel = new ExpertPanel({
        question,
        experts,
        aggregationStrategy: body.aggregationStrategy,
        timeout: body.timeout
      });

      const session = await panel.consult();
      sessions.set(session.id, session);

      log.info(`Consultation created: ${session.id}`);
      ctx.status = 201;
      ctx.body = { session };
    } catch (err) {
      log.error('Failed to create consultation:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to create consultation' };
    }
  });

  log.info('[Consultation] HTTP routes registered');
}
