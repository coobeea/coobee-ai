/**
 * Task Router Extension
 *
 * 事件驱动的智能任务路由器（方案 B：LLM 驱动的任务分发员）。
 *
 * 监听 agent:done 事件，创建 Thread 并拉起 task-dispatcher 智能体，
 * 由 task-dispatcher 通过 LLM 判断哪些智能体需要跟进处理。
 *
 * 与共享网盘（SharedDrive）配合，形成多智能体任务处理环：
 *   智能体完成 → 写网盘 → agent:done 事件 → task-dispatcher 分析 → 分发后续任务
 */

import type { ExtensionModule, ExtensionApi } from '@main/common/extension';

const TASK_DISPATCHER_AGENT_ID = 'task-dispatcher';
const DISPATCH_DELAY_MS = 3000;

let logger: ExtensionApi['logger'];
let eventBusRef: ExtensionApi['eventBus'];
let agentDoneHandler: ((payload: Record<string, unknown>) => void) | null = null;
let enabled = true;

function buildDispatchMessage(payload: Record<string, unknown>): string {
  const agentId = String(payload.agentId || 'unknown');
  const agentName = String(payload.agentName || 'unknown');
  const summary = String(payload.summary || '(无概述)');
  const sessionId = String(payload.sessionId || '');
  const durationMs = payload.durationMs ? Number(payload.durationMs) : 0;
  const sharedDriveEntryId = payload.sharedDriveEntryId ? String(payload.sharedDriveEntryId) : null;

  let message = `## 智能体任务完成通知\n\n`;
  message += `- **智能体**: ${agentName} (\`${agentId}\`)\n`;
  message += `- **会话 ID**: ${sessionId}\n`;
  message += `- **耗时**: ${Math.round(durationMs / 1000)}s\n`;
  message += `- **成果概述**:\n\n${summary}\n\n`;

  if (sharedDriveEntryId) {
    message += `- **共享网盘条目 ID**: \`${sharedDriveEntryId}\`\n`;
    message += `  请通过 SharedDrive API 获取详情: \`GET /gateway/shared-drive/entries/${sharedDriveEntryId}\`\n\n`;
  }

  message += `请分析以上成果，判断系统中是否有其他智能体需要基于此成果做跟进处理。\n`;
  message += `如果有，请使用 delegate_to_agent 分发任务；如果没有，报告「无需跟进」。`;

  return message;
}

function shouldDispatch(payload: Record<string, unknown>): boolean {
  if (!enabled) return false;

  // 只处理成功的事件
  if (payload.success !== true) return false;

  // 跳过 task-dispatcher 自身的事件，避免无限循环
  const agentId = String(payload.agentId || '');
  if (agentId === TASK_DISPATCHER_AGENT_ID) return false;

  // 跳过 task-router 触发的会话
  const sid = String(payload.sessionId || '');
  if (sid.startsWith('task-router:')) return false;

  // 跳过没有实质内容的事件
  const summary = String(payload.summary || '');
  if (summary.length < 20) return false;

  // 跳过子 Agent 会话（包含 :delegate: 的 sessionId）
  if (sid.includes(':delegate:')) return false;

  return true;
}

async function queryRecentSharedDriveEntry(agentId: string): Promise<string | null> {
  try {
    const { SharedDriveStore } = await import('@main/ai/shared-drive/SharedDriveStore');
    const store = await SharedDriveStore.getInstance();
    const entries = await store.list({ agentId, limit: 1 });
    if (entries.length > 0) {
      return entries[0].id;
    }
  } catch {
    // SharedDrive 不可用时静默
  }
  return null;
}

async function dispatchToAnalyzer(payload: Record<string, unknown>): Promise<void> {
  try {
    const { agentExecutor } = await import('@main/ai/AgentExecutor');
    const { AgentStore } = await import('@main/ai/agents/AgentStore');
    const { ThreadStore } = await import('@main/ai/threads/ThreadStore');

    // 检查 task-dispatcher 智能体是否存在
    const store = await AgentStore.getInstance();
    const dispatcherDef = await store.get(TASK_DISPATCHER_AGENT_ID);
    if (!dispatcherDef) {
      logger?.warn?.(`[TaskRouter] Agent "${TASK_DISPATCHER_AGENT_ID}" not found, skipping dispatch`);
      return;
    }

    // 创建 Thread 以便追踪
    const threadStore = await ThreadStore.getInstance();
    const sourceAgent = String(payload.agentName || payload.agentId || 'unknown');
    const thread = await threadStore.create({
      title: `[Task Route] ${sourceAgent} 成果分析`,
      agentId: TASK_DISPATCHER_AGENT_ID,
      agentMode: 'agent',
      agentType: 'agent',
      metadata: {
        source: 'task-router',
        sourceAgentId: String(payload.agentId || ''),
        sourceSessionId: String(payload.sessionId || ''),
        triggeredAt: new Date().toISOString()
      }
    });

    const sessionId = thread.id;

    // 查询该智能体最近写入 SharedDrive 的条目
    if (!payload.sharedDriveEntryId) {
      const entryId = await queryRecentSharedDriveEntry(String(payload.agentId || ''));
      if (entryId) {
        payload.sharedDriveEntryId = entryId;
      }
    }

    const message = buildDispatchMessage(payload);

    logger?.info?.(
      `[TaskRouter] Dispatching to ${TASK_DISPATCHER_AGENT_ID}, thread=${sessionId}, source=${payload.agentId}`
    );

    // 使用 chat.send 的模式：加载智能体定义 → 创建 builder → submit
    const { builtinTools } = await import('@main/ai/tools');
    const { ToolRegistry } = await import('@main/ai/tools/registry');
    const { SkillManager } = await import('@main/ai/skills');

    const builder = agentExecutor
      .piMono()
      .name(dispatcherDef.name || dispatcherDef.id)
      .mode('agent')
      .sessionMode('file')
      .instructions(dispatcherDef.instructions);

    // 加载工具
    const registry = ToolRegistry.getInstance();
    const extTools = registry.getAll();
    const allTools = [...builtinTools, ...extTools];
    const candidateTools = dispatcherDef.tools?.length
      ? allTools.filter((t) => dispatcherDef.tools!.includes(t.name))
      : allTools;
    builder.tools(candidateTools);

    // 加载 Skill
    if (dispatcherDef.skills?.length) {
      const skillManager = new SkillManager();
      const { Env } = await import('@main/common/env');
      skillManager.scanSkills(undefined, Env.paths.secretsDir);

      const skillDefs = dispatcherDef.skills
        .map((name: string) => skillManager.getByName(name))
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (skillDefs.length > 0) {
        builder.skills(skillDefs);
      }
    }

    // 模型配置
    if (dispatcherDef.model) {
      builder.model(dispatcherDef.model);
    }
    if (dispatcherDef.thinkingLevel) {
      builder.thinkingLevel(dispatcherDef.thinkingLevel);
    }

    const result = agentExecutor.submit({
      sessionId,
      message,
      builder
    });

    if (result.status === 'busy') {
      logger?.warn?.(`[TaskRouter] Session ${sessionId} busy, skipping`);
    } else {
      logger?.info?.(`[TaskRouter] Dispatch accepted: session=${sessionId}`);
    }
  } catch (err) {
    logger?.error?.('[TaskRouter] Failed to dispatch:', err);
  }
}

function handleAgentDone(payload: Record<string, unknown>): void {
  if (!shouldDispatch(payload)) return;

  logger?.info?.(`[TaskRouter] agent:done from ${payload.agentId}, scheduling dispatch in ${DISPATCH_DELAY_MS}ms`);

  setTimeout(() => {
    dispatchToAnalyzer(payload).catch((err) => {
      logger?.error?.('[TaskRouter] Dispatch failed:', err);
    });
  }, DISPATCH_DELAY_MS);
}

export default {
  id: 'task-router',
  name: 'Task Router',

  register: async (api) => {
    logger = api.logger;
    eventBusRef = api.eventBus;

    // 检查是否通过配置禁用
    try {
      const { Env } = await import('@main/common/env');
      const { promises: fs } = await import('fs');
      const configPath = await import('path').then((p) => p.join(Env.paths.configDir, 'task-routes.json'));
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.enabled === false) {
          enabled = false;
          logger.info('[TaskRouter] Disabled by config');
        }
      } catch {
        // 配置文件不存在，默认启用
      }
    } catch {
      // Env 不可用，默认启用
    }

    // 注册 Channel
    api.registerChannel({
      id: 'task-router-channel',
      name: 'Task Router Channel',
      gateway: {
        start: (ctx) => {
          ctx.log.info('[TaskRouter] Channel started');
        },
        stop: (ctx) => {
          ctx.log.info('[TaskRouter] Channel stopped');
        }
      }
    });

    // 监听 agent:done 事件
    agentDoneHandler = handleAgentDone;
    api.eventBus.on('agent:done', agentDoneHandler);

    logger.info(`[TaskRouter] Registered (enabled=${enabled}, dispatcher=${TASK_DISPATCHER_AGENT_ID})`);
  },

  unregister: () => {
    if (agentDoneHandler && eventBusRef) {
      eventBusRef.off('agent:done', agentDoneHandler);
      agentDoneHandler = null;
    }
    enabled = true;
    logger?.info?.('[TaskRouter] Unregistered');
  }
} satisfies ExtensionModule;
