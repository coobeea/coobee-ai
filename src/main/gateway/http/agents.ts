/**
 * Agents HTTP 路由
 *
 * 为智能体 CRUD 操作注册标准 REST HTTP 端点。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/agents           — 列出所有智能体
 *   GET    /gateway/agents/:id       — 获取智能体详情
 *   POST   /gateway/agents           — 手动创建智能体
 *   POST   /gateway/agents/ai-create — AI 驱动创建智能体
 *   DELETE /gateway/agents/:id       — 删除智能体
 *
 * 设计：
 *   - 直接调用 AgentStore / AgentCreatorService，不经过 WS RPC 层
 *   - 标准 JSON 请求/响应，前端用 fetch 即可
 *   - 错误统一返回 { error: string } + 对应 HTTP 状态码
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { AgentStore } from '@main/ai/agents/AgentStore';
import { aiCreateAgent } from '@main/ai/services/AgentCreatorService';
import type { AiCreateProgress } from '@main/ai/services/AgentCreatorService';

const log = createLogger('gateway-http-agents');

export function registerAgentRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/agents', async (ctx) => {
    try {
      const store = await AgentStore.getInstance();
      const agents = await store.list();
      ctx.body = { agents };
    } catch (err) {
      log.error('[agents.list] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== GET ====================

  router.get('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    try {
      const store = await AgentStore.getInstance();
      const agent = await store.get(agentId);
      if (!agent) {
        ctx.status = 404;
        ctx.body = { error: `Agent "${agentId}" not found` };
        return;
      }
      ctx.body = { agent };
    } catch (err) {
      log.error(`[agents.get] Error (${agentId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== CREATE ====================

  router.post('/agents', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const { id, name, description, instructions, tools, skills } = (body ?? {}) as {
      id?: string;
      name?: string;
      description?: string;
      instructions?: string;
      tools?: string[];
      skills?: string[];
    };

    if (!id || !name || !description || !instructions) {
      ctx.status = 400;
      ctx.body = { error: 'id, name, description, instructions are required' };
      return;
    }

    try {
      const store = await AgentStore.getInstance();
      const agent = await store.create({
        id,
        name,
        description,
        instructions,
        tools,
        skills,
        createdBy: 'user'
      });
      ctx.status = 201;
      ctx.body = { agent };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('[agents.create] Error:', err);
      // ID 重复或格式错误 → 400，其他 → 500
      ctx.status = msg.includes('already exists') || msg.includes('Invalid agent ID') ? 400 : 500;
      ctx.body = { error: msg };
    }
  });

  // ==================== AI CREATE (SSE) ====================

  router.post('/agents/ai-create', async (ctx) => {
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const requirement = (body as { requirement?: string })?.requirement;

    if (!requirement || !requirement.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'requirement is required' };
      return;
    }

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

    /** 进度回调 → SSE 推送 */
    const onProgress = (progress: AiCreateProgress): void => {
      sendEvent('progress', progress);
    };

    try {
      const result = await aiCreateAgent(requirement.trim(), onProgress);
      sendEvent('result', { agent: result.agent });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('[agents.aiCreate] Error:', err);
      sendEvent('error', { error: msg });
    } finally {
      stream.end();
    }
  });

  // ==================== UPDATE (PATCH) ====================

  router.patch('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    if (!body || Object.keys(body).length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'Request body is empty' };
      return;
    }

    try {
      const store = await AgentStore.getInstance();
      const agent = await store.update(agentId, {
        name: body.name as string | undefined,
        description: body.description as string | undefined,
        instructions: body.instructions as string | undefined,
        tools: body.tools as string[] | undefined,
        skills: body.skills as string[] | undefined,
        model: body.model as string | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined
      });
      if (!agent) {
        ctx.status = 404;
        ctx.body = { error: `Agent "${agentId}" not found` };
        return;
      }
      ctx.body = { agent };
    } catch (err) {
      log.error(`[agents.update] Error (${agentId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== DELETE ====================

  router.delete('/agents/:id', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    try {
      const store = await AgentStore.getInstance();
      const deleted = await store.delete(agentId);
      if (!deleted) {
        ctx.status = 404;
        ctx.body = { error: `Agent "${agentId}" not found` };
        return;
      }
      ctx.body = { agentId, deleted: true };
    } catch (err) {
      log.error(`[agents.delete] Error (${agentId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[agents] HTTP routes registered');
}
