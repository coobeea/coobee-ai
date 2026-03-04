/**
 * 共享网盘任务路由 (Shared Drive Task Router)
 *
 * 监听 shared-drive:entry-created 事件，创建 Thread 并拉起 task-dispatcher 智能体，
 * 由 task-dispatcher 通过 LLM 判断哪些智能体需要基于网盘成果做跟进处理。
 *
 * 闭环流程：
 *   智能体完成任务 → 写入共享网盘 → entry-created 事件 → task-dispatcher 分析 → 分发后续任务
 */

import type { ExtensionModule, ExtensionApi } from '@main/common/extension';

const TASK_DISPATCHER_AGENT_ID = 'task-dispatcher';
const DISPATCH_DELAY_MS = 2000;

let logger: ExtensionApi['logger'];
let eventBusRef: ExtensionApi['eventBus'];
let entryCreatedHandler: ((payload: Record<string, unknown>) => void) | null = null;
let enabled = true;

interface EntryCreatedPayload {
  entryId: string;
  agentId: string;
  topic: string;
  date?: string;
  tags?: string[];
  summary?: string;
  path?: string;
  timestamp: number;
}

function buildDispatchMessage(payload: EntryCreatedPayload): string {
  let message = `## 共享网盘新条目通知\n\n`;
  message += `- **写入智能体**: \`${payload.agentId}\`\n`;
  message += `- **条目 ID**: \`${payload.entryId}\`\n`;
  message += `- **主题**: ${payload.topic}\n`;
  if (payload.date) {
    message += `- **日期**: ${payload.date}\n`;
  }
  if (payload.tags?.length) {
    message += `- **标签**: ${payload.tags.join(', ')}\n`;
  }
  if (payload.summary) {
    message += `- **摘要**: ${payload.summary}\n`;
  }
  message += `\n请通过 SharedDrive API 获取完整详情:\n`;
  message += `\`GET /gateway/shared-drive/entries/${payload.entryId}\`\n\n`;
  message += `请分析以上成果，判断系统中是否有其他智能体需要基于此成果做跟进处理。\n`;
  message += `如果有，请使用 delegate_to_agent 分发任务；如果没有，报告「无需跟进」。`;

  return message;
}

function shouldDispatch(payload: EntryCreatedPayload): boolean {
  if (!enabled) return false;

  // 跳过 task-dispatcher 自身写入的条目，避免循环
  if (payload.agentId === TASK_DISPATCHER_AGENT_ID) return false;

  // 条目必须有实质 topic
  if (!payload.topic || payload.topic.length < 3) return false;

  return true;
}

async function dispatchToAnalyzer(payload: EntryCreatedPayload): Promise<void> {
  try {
    const { agentExecutor } = await import('@main/ai/AgentExecutor');
    const { AgentStore } = await import('@main/ai/agents/AgentStore');
    const { ThreadStore } = await import('@main/ai/threads/ThreadStore');

    const store = await AgentStore.getInstance();
    const dispatcherDef = await store.get(TASK_DISPATCHER_AGENT_ID);
    if (!dispatcherDef) {
      logger?.warn?.(`[SDTaskRouter] Agent "${TASK_DISPATCHER_AGENT_ID}" not found, skipping`);
      return;
    }

    // 创建 Thread 以便追踪
    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.create({
      title: `[Task Route] ${payload.agentId}: ${payload.topic}`,
      agentId: TASK_DISPATCHER_AGENT_ID,
      agentMode: 'agent',
      agentType: 'agent',
      metadata: {
        source: 'task-router',
        sourceAgentId: payload.agentId,
        entryId: payload.entryId,
        topic: payload.topic,
        triggeredAt: new Date().toISOString()
      }
    });

    const sessionId = thread.id;
    const message = buildDispatchMessage(payload);

    logger?.info?.(
      `[SDTaskRouter] Dispatching to ${TASK_DISPATCHER_AGENT_ID}, thread=${sessionId}, entry=${payload.entryId}`
    );

    const { builtinTools } = await import('@main/ai/tools');
    const { ToolRegistry } = await import('@main/ai/tools/registry');
    const { SkillManager } = await import('@main/ai/skills');

    const builder = agentExecutor
      .piMono()
      .name(dispatcherDef.name || dispatcherDef.id)
      .mode('agent')
      .sessionMode('file')
      .instructions(dispatcherDef.instructions);

    const registry = ToolRegistry.getInstance();
    const extTools = registry.getAll();
    const allTools = [...builtinTools, ...extTools];
    const candidateTools = dispatcherDef.tools?.length
      ? allTools.filter((t) => dispatcherDef.tools!.includes(t.name))
      : allTools;
    builder.tools(candidateTools);

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

    if (dispatcherDef.model) {
      builder.model(dispatcherDef.model);
    }
    if (dispatcherDef.thinkingLevel) {
      builder.thinkingLevel(dispatcherDef.thinkingLevel);
    }

    const result = agentExecutor.submit({ sessionId, message, builder });

    if (result.status === 'busy') {
      logger?.warn?.(`[SDTaskRouter] Session ${sessionId} busy, skipping`);
    } else {
      logger?.info?.(`[SDTaskRouter] Dispatch accepted: session=${sessionId}`);
    }
  } catch (err) {
    logger?.error?.('[SDTaskRouter] Failed to dispatch:', err);
  }
}

function handleEntryCreated(payload: Record<string, unknown>): void {
  const typed = payload as unknown as EntryCreatedPayload;
  if (!shouldDispatch(typed)) return;

  logger?.info?.(
    `[SDTaskRouter] entry-created by ${typed.agentId}, topic="${typed.topic}", dispatching in ${DISPATCH_DELAY_MS}ms`
  );

  setTimeout(() => {
    dispatchToAnalyzer(typed).catch((err) => {
      logger?.error?.('[SDTaskRouter] Dispatch failed:', err);
    });
  }, DISPATCH_DELAY_MS);
}

export default {
  id: 'shared-drive-task-router',
  name: '共享网盘任务路由',

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
          logger.info('[SDTaskRouter] Disabled by config');
        }
      } catch {
        // 配置文件不存在，默认启用
      }
    } catch {
      // Env 不可用，默认启用
    }

    api.registerChannel({
      id: 'task-router-channel',
      name: 'Task Router Channel',
      gateway: {
        start: (ctx) => {
          ctx.log.info('[SDTaskRouter] Channel started');
        },
        stop: (ctx) => {
          ctx.log.info('[SDTaskRouter] Channel stopped');
        }
      }
    });

    // 监听共享网盘条目创建事件
    entryCreatedHandler = handleEntryCreated;
    api.eventBus.on('shared-drive:entry-created', entryCreatedHandler);

    logger.info(`[SDTaskRouter] Registered (enabled=${enabled}, dispatcher=${TASK_DISPATCHER_AGENT_ID})`);
  },

  unregister: () => {
    if (entryCreatedHandler && eventBusRef) {
      eventBusRef.off('shared-drive:entry-created', entryCreatedHandler);
      entryCreatedHandler = null;
    }
    enabled = true;
    logger?.info?.('[SDTaskRouter] Unregistered');
  }
} satisfies ExtensionModule;
