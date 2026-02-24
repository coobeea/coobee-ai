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
import { agentExecutor } from '@main/ai/AgentExecutor';
import { builtinTools } from '@main/ai/tools';
import { ToolRegistry } from '@main/ai/tools/registry';
import { SkillManager } from '@main/ai/skills';
import { Env } from '@main/common/env';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import type { AgentDefinition } from '@main/ai/agents/types';
import type { AgentMode, SkillDefinition } from '@main/ai/runtime/types';
import type { StreamChunk } from '@main/ai/runtime/types';

const log = createLogger('gateway-http-agents');

/** Chat 模式禁用的工具名称列表 */
const CHAT_MODE_BLOCKED_TOOLS = new Set(['exec']);

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
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[agents.delete] Error (${agentId}):`, err);
      // 内置 Agent 删除 → 403
      ctx.status = msg.includes('cannot be deleted') ? 403 : 500;
      ctx.body = { error: msg };
    }
  });

  // ==================== AGENT SKILLS ====================

  router.get('/agents/:id/skills', async (ctx) => {
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

      const skillNames = agent.skills ?? [];
      if (skillNames.length === 0) {
        ctx.body = { skills: [] };
        return;
      }

      const skillDefs = loadSkillDefinitions(skillNames);
      const skills = skillDefs.map((s) => ({
        name: s.name,
        description: s.description || ''
      }));

      ctx.body = { skills };
    } catch (err) {
      log.error(`[agents.skills] Error (${agentId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== QUICK CHAT (SSE) ====================

  router.post('/agents/:id/quick-chat', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    const message = body?.message as string | undefined;

    if (!message || !message.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'message is required' };
      return;
    }

    // 加载 Agent 定义
    let agentDef: AgentDefinition | null = null;
    try {
      const store = await AgentStore.getInstance();
      agentDef = await store.get(agentId);
      if (!agentDef) {
        ctx.status = 404;
        ctx.body = { error: `Agent "${agentId}" not found` };
        return;
      }
    } catch (err) {
      log.error(`[agents.quickChat] Failed to load agent ${agentId}:`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
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

    // 临时 sessionId（不持久化）
    const sessionId = `quick-${generateSnowflakeId()}`;

    try {
      // 创建 Builder
      const builder = createBuilderFromAgentDef(agentDef, 'chat');

      // 发送开始事件
      sendEvent('start', { agentId, sessionId });

      // 执行流式对话
      const gen = agentExecutor.stream({ sessionId, message: message.trim(), builder });

      let output = '';
      let r = await gen.next();
      while (!r.done) {
        const chunk: StreamChunk = r.value;

        // 流式推送文本增量
        if (chunk.type === 'text:delta' && chunk.content) {
          output += chunk.content;
          sendEvent('delta', { content: chunk.content });
        }

        r = await gen.next();
      }

      // 发送完成事件
      sendEvent('done', { output: output.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[agents.quickChat] Error (${agentId}):`, err);
      sendEvent('error', { error: msg });
    } finally {
      stream.end();
    }
  });

  log.info('[agents] HTTP routes registered');
}

/**
 * 从 AgentDefinition 创建 Builder（quick-chat 专用）
 */
function createBuilderFromAgentDef(
  def: AgentDefinition,
  agentMode: AgentMode
): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(def.name || def.id)
    .mode(agentMode)
    .sessionMode('memory')
    .lightweight(true)
    .instructions(def.instructions);

  // 合并 builtin + Extension 工具
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }

  // 工具过滤逻辑（两层过滤）
  let candidateTools;
  if (def.tools && def.tools.length > 0) {
    // 1. Agent 定义中明确指定了工具列表 → 按配置加载
    candidateTools = def.tools
      .map((name) => toolMap.get(name))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
  } else {
    // 2. 未配置工具 → 加载所有可用工具（向后兼容）
    candidateTools = Array.from(toolMap.values());
  }

  // 3. 根据模式进行二次过滤（chat 模式强制排除危险工具）
  const finalTools =
    agentMode === 'chat' ? candidateTools.filter((t) => !CHAT_MODE_BLOCKED_TOOLS.has(t.name)) : candidateTools;

  builder.tools(finalTools);

  // 加载 Skills
  if (def.skills && def.skills.length > 0) {
    try {
      const skillDefs = loadSkillDefinitions(def.skills);
      if (skillDefs.length > 0) {
        builder.skills(skillDefs);
      }
    } catch (err) {
      log.error(`[createBuilderFromAgentDef] Failed to load skills:`, err);
    }
  }

  // 覆盖模型和思维链级别
  if (def.model) {
    builder.model(def.model);
  }
  if (def.thinkingLevel) {
    builder.thinkingLevel(def.thinkingLevel);
  }

  return builder;
}

/**
 * 加载 Skills 定义（简化版，只扫描 builtin + user）
 */
function loadSkillDefinitions(skillNames: string[]): SkillDefinition[] {
  try {
    const searchPaths = [Env.paths.builtinSkillsDir, Env.paths.userSkillsDir];
    const secretsDir = Env.paths.secretsDir;

    const manager = new SkillManager();
    const allSkills = manager.scanSkills(searchPaths, secretsDir);

    const skillMap = new Map(allSkills.map((s) => [s.name, s]));
    const result: SkillDefinition[] = [];

    for (const name of skillNames) {
      const skill = skillMap.get(name);
      if (skill) {
        result.push(skill);
      } else {
        log.warn(`[loadSkillDefinitions] Skill "${name}" not found`);
      }
    }

    return result;
  } catch (err) {
    log.error('[loadSkillDefinitions] Error:', err);
    return [];
  }
}
