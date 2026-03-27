/**
 * 实时洞察 HTTP 路由
 */

import type { Context } from 'koa';
import type Router from '@koa/router';
import { InsightOrchestrator } from '@main/insight/InsightOrchestrator';
import { log } from '@main/common/logger';
import type { AnalysisTemplate, SessionConfig } from '@shared/types/insight';

let orchestrator: InsightOrchestrator;

function ensure(): InsightOrchestrator {
  if (!orchestrator) {
    orchestrator = InsightOrchestrator.getInstance();
  }
  return orchestrator;
}

export function registerInsightRoutes(router: Router): void {
  // ==================== Templates ====================

  router.get('/insight/templates', (ctx: Context) => {
    ctx.body = { success: true, data: ensure().listTemplates() };
  });

  router.get('/insight/templates/:id', (ctx: Context) => {
    const template = ensure().getTemplate(ctx.params.id);
    if (!template) {
      ctx.status = 404;
      ctx.body = { success: false, error: '模板不存在' };
      return;
    }
    ctx.body = { success: true, data: template };
  });

  router.post('/insight/templates', (ctx: Context) => {
    try {
      const body = ctx.request.body as Omit<AnalysisTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'>;
      const template = ensure().createTemplate(body);
      ctx.body = { success: true, data: template };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  router.put('/insight/templates/:id', (ctx: Context) => {
    const updated = ensure().updateTemplate(ctx.params.id, ctx.request.body as Partial<AnalysisTemplate>);
    if (!updated) {
      ctx.status = 400;
      ctx.body = { success: false, error: '更新失败（内置模板不可修改）' };
      return;
    }
    ctx.body = { success: true, data: updated };
  });

  router.delete('/insight/templates/:id', (ctx: Context) => {
    const ok = ensure().deleteTemplate(ctx.params.id);
    ctx.body = { success: ok, error: ok ? undefined : '删除失败' };
  });

  // ==================== Sessions ====================

  router.post('/insight/sessions', (ctx: Context) => {
    try {
      const { templateId } = ctx.request.body as { templateId: string };
      if (!templateId) {
        ctx.status = 400;
        ctx.body = { success: false, error: '缺少 templateId' };
        return;
      }
      const session = ensure().startSession(templateId);
      ctx.body = { success: true, data: session };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: String(err) };
    }
  });

  router.get('/insight/sessions', (ctx: Context) => {
    const date = ctx.query.date as string | undefined;
    ctx.body = { success: true, data: ensure().listSessions(date ? { date } : undefined) };
  });

  router.get('/insight/sessions/active', (ctx: Context) => {
    ctx.body = { success: true, data: ensure().getActiveSession() };
  });

  router.get('/insight/sessions/:id', (ctx: Context) => {
    const session = ensure().getSession(ctx.params.id);
    if (!session) {
      ctx.status = 404;
      ctx.body = { success: false, error: '会话不存在' };
      return;
    }
    ctx.body = { success: true, data: session };
  });

  router.put('/insight/sessions/:id/pause', (ctx: Context) => {
    const session = ensure().pauseSession(ctx.params.id);
    ctx.body = { success: !!session, data: session };
  });

  router.put('/insight/sessions/:id/resume', (ctx: Context) => {
    const session = ensure().resumeSession(ctx.params.id);
    ctx.body = { success: !!session, data: session };
  });

  router.put('/insight/sessions/:id/complete', (ctx: Context) => {
    const session = ensure().completeSession(ctx.params.id);
    ctx.body = { success: !!session, data: session };
  });

  router.delete('/insight/sessions/:id', (ctx: Context) => {
    const ok = ensure().deleteSession(ctx.params.id);
    ctx.body = { success: ok };
  });

  // ==================== Analysis ====================

  router.put('/insight/sessions/:id/config', (ctx: Context) => {
    const config = ctx.request.body as SessionConfig;
    const session = ensure().updateSessionConfig(ctx.params.id, config);
    if (!session) {
      ctx.status = 400;
      ctx.body = { success: false, error: '只能更新活跃会话的配置' };
      return;
    }
    ctx.body = { success: true, data: session };
  });

  router.post('/insight/sessions/:id/transcript', (ctx: Context) => {
    const { text } = ctx.request.body as { text: string };
    ensure().appendTranscript(ctx.params.id, text);
    ctx.body = { success: true };
  });

  router.post('/insight/sessions/:id/silence', (ctx: Context) => {
    ensure().notifySilence(ctx.params.id);
    ctx.body = { success: true };
  });

  router.post('/insight/sessions/:id/analyze', (ctx: Context) => {
    ensure().triggerAnalysis(ctx.params.id);
    ctx.body = { success: true, message: '分析已触发' };
  });

  router.get('/insight/sessions/:id/result', (ctx: Context) => {
    const session = ensure().getSession(ctx.params.id);
    ctx.body = { success: true, data: session?.latestResult ?? null };
  });

  // ==================== Snapshots ====================

  router.get('/insight/sessions/:id/snapshots', (ctx: Context) => {
    const snapshots = ensure().getSnapshots(ctx.params.id);
    ctx.body = { success: true, data: snapshots };
  });

  router.get('/insight/sessions/:id/snapshots/:snapId', (ctx: Context) => {
    const snapshot = ensure().getSnapshot(ctx.params.id, ctx.params.snapId);
    if (!snapshot) {
      ctx.status = 404;
      ctx.body = { success: false, error: '快照不存在' };
      return;
    }
    ctx.body = { success: true, data: snapshot };
  });

  log.info('[InsightRoutes] Registered');
}
