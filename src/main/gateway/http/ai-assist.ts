/**
 * AI 辅助服务 HTTP 路由
 *
 * 统一的 SSE 端点，支持各种轻量级 AI 辅助任务。
 * 所有任务走 AgentExecutor chat 模式，前端无需关心执行细节。
 *
 * 端点：
 *   POST /gateway/ai-assist — 执行 AI 辅助任务（SSE 流式响应）
 *
 * 请求体：
 *   { task: "generate-title", params: { ... } }
 *
 * SSE 事件：
 *   progress — 进度更新 { step, message }
 *   result   — 成功结果 { task, ok: true, data, rawOutput }
 *   error    — 失败信息 { task, ok: false, error }
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { executeAssistTask, getRegisteredTasks } from '@main/ai/services/AiAssistService';
import { registerBuiltinTasks } from '@main/ai/services/tasks';

const log = createLogger('gateway-http-ai-assist');

/** 确保内置 task 只注册一次 */
let initialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    registerBuiltinTasks();
    initialized = true;
  }
}

export function registerAiAssistRoutes(router: Router): void {
  ensureInitialized();

  // ==================== 执行 AI 辅助任务（SSE） ====================

  router.post('/ai-assist', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const task = body?.task as string | undefined;
    const params = (body?.params ?? {}) as Record<string, unknown>;

    if (!task || typeof task !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'task is required (string)' };
      return;
    }

    log.info(`[ai-assist] Task: ${task}, params: ${JSON.stringify(params).slice(0, 200)}`);

    // 设置 SSE 响应头
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');

    const { PassThrough } = await import('stream');
    const stream = new PassThrough();
    ctx.body = stream;
    ctx.status = 200;

    /** 发送 SSE 事件 */
    const sendEvent = (event: string, data: unknown): void => {
      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await executeAssistTask(task, params, (progress) => {
        sendEvent('progress', progress);
      });

      if (result.ok) {
        sendEvent('result', result);
      } else {
        sendEvent('error', result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[ai-assist] Unexpected error for task "${task}":`, err);
      sendEvent('error', { task, ok: false, error: msg });
    } finally {
      stream.end();
    }
  });

  // ==================== 查询可用任务列表 ====================

  router.get('/ai-assist/tasks', async (ctx) => {
    ctx.body = { tasks: getRegisteredTasks() };
  });

  log.info('[ai-assist] HTTP routes registered');
}
