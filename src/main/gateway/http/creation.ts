import type Router from '@koa/router';
import type { Context } from 'koa';
import { CreationPipeline } from '@main/creation/CreationPipeline';
import { CreationStore } from '@main/creation/CreationStore';
import type { CreationTargetType, KnowledgeItem } from '@shared/types/creation';

function getPipeline(): CreationPipeline {
  return CreationPipeline.getInstance();
}

function getStore(): CreationStore {
  return CreationStore.getInstance();
}

export function registerCreationRoutes(router: Router): void {
  // ==================== Phase 1：对话交互 ====================

  router.post('/creation/start', async (ctx: Context) => {
    const { requirement, targetType } = ctx.request.body as {
      requirement: string;
      targetType: CreationTargetType;
    };

    if (!requirement || !targetType) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'requirement and targetType are required' };
      return;
    }

    const session = await getPipeline().start(requirement, targetType);
    ctx.body = { success: true, data: session };
  });

  router.post('/creation/sessions/:id/chat', async (ctx: Context) => {
    const { message } = ctx.request.body as { message: string };
    if (!message) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'message is required' };
      return;
    }

    try {
      const reply = await getPipeline().chat(ctx.params.id, message);
      ctx.body = { success: true, data: { reply } };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post('/creation/sessions/:id/finish-requirements', async (ctx: Context) => {
    const { files } = ctx.request.body as { files: { filename: string; content: string }[] };
    if (!files || !Array.isArray(files)) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'files array is required' };
      return;
    }

    try {
      await getPipeline().finishRequirements(ctx.params.id, files);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== 知识库 ====================

  router.post('/creation/sessions/:id/knowledge', (ctx: Context) => {
    const item = ctx.request.body as KnowledgeItem;
    try {
      getStore().addKnowledge(ctx.params.id, item);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  router.delete('/creation/sessions/:id/knowledge/:name', (ctx: Context) => {
    const removed = getStore().removeKnowledge(ctx.params.id, ctx.params.name);
    ctx.body = { success: removed };
  });

  // ==================== 对话记录 ====================

  router.get('/creation/sessions/:id/transcript', (ctx: Context) => {
    const transcript = getStore().loadTranscript(ctx.params.id);
    ctx.body = { success: true, data: transcript };
  });

  // ==================== 通用 ====================

  router.get('/creation/sessions', (ctx: Context) => {
    ctx.body = { success: true, data: getPipeline().listSessions() };
  });

  router.get('/creation/sessions/:id', (ctx: Context) => {
    const session = getPipeline().getSession(ctx.params.id);
    if (!session) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Session not found' };
      return;
    }
    ctx.body = { success: true, data: session };
  });

  router.delete('/creation/sessions/:id', (ctx: Context) => {
    const deleted = getPipeline().deleteSession(ctx.params.id);
    ctx.body = { success: deleted };
  });

  // ==================== 文件浏览 ====================

  router.get('/creation/sessions/:id/files', (ctx: Context) => {
    const files = getStore().listFiles(ctx.params.id);
    ctx.body = { success: true, data: files };
  });

  router.get('/creation/sessions/:id/files/:name', (ctx: Context) => {
    const content = getStore().readFile(ctx.params.id, ctx.params.name);
    if (content === null) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'File not found' };
      return;
    }
    ctx.body = { success: true, data: { filename: ctx.params.name, content } };
  });

  // ==================== 自动执行控制 ====================

  router.post('/creation/sessions/:id/launch', async (ctx: Context) => {
    try {
      await getPipeline().launchAutopilot(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post('/creation/sessions/:id/pause', async (ctx: Context) => {
    await getPipeline().pause(ctx.params.id);
    ctx.body = { success: true };
  });

  router.post('/creation/sessions/:id/resume', async (ctx: Context) => {
    try {
      await getPipeline().resume(ctx.params.id);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 400;
      ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
