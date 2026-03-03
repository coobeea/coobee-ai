/**
 * Task Router Extension
 *
 * 事件驱动的智能体任务路由器。
 * 监听 agent:done 事件，根据配置的路由规则自动触发后续任务。
 *
 * 路由规则来源：
 *   1. .home/config/task-routes.json（用户配置）
 *   2. Extension 代码中的默认规则
 *
 * 与共享网盘（SharedDrive）配合，形成多智能体任务处理环。
 */

import type { ExtensionModule, ExtensionApi } from '@main/common/extension';
import { promises as fs } from 'fs';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface TaskRouteTrigger {
  /** 触发的智能体 ID（精确匹配或 '*' 匹配所有） */
  agentId: string;
  /** 事件中 summary 的关键词匹配（可选） */
  summaryMatch?: string;
  /** 仅在成功时触发（默认 true） */
  onSuccess?: boolean;
}

export interface TaskRouteAction {
  /** 目标智能体 ID */
  agentId: string;
  /** 任务描述模板（支持 {agentId}, {agentName}, {summary} 占位符） */
  task: string;
  /** 延迟执行（毫秒，防止过于频繁，默认 2000） */
  delayMs?: number;
}

export interface TaskRoute {
  /** 路由 ID */
  id: string;
  /** 路由名称 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** 触发条件 */
  trigger: TaskRouteTrigger;
  /** 执行动作 */
  action: TaskRouteAction;
}

export interface TaskRoutesConfig {
  routes: TaskRoute[];
}

// ==================== Extension ====================

let logger: ExtensionApi['logger'];
let eventBusRef: ExtensionApi['eventBus'];
let agentDoneHandler: ((payload: Record<string, unknown>) => void) | null = null;
let routes: TaskRoute[] = [];

async function loadRoutes(configDir: string): Promise<TaskRoute[]> {
  const configPath = path.join(configDir, 'task-routes.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as TaskRoutesConfig;
    return config.routes.filter((r) => r.enabled);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger?.info?.('[TaskRouter] No task-routes.json found, using empty routes');
      return [];
    }
    logger?.error?.('[TaskRouter] Failed to load routes:', err);
    return [];
  }
}

function matchRoute(route: TaskRoute, payload: Record<string, unknown>): boolean {
  const { trigger } = route;

  // agentId 匹配
  if (trigger.agentId !== '*' && trigger.agentId !== payload.agentId) {
    return false;
  }

  // 成功条件
  if (trigger.onSuccess !== false && payload.success !== true) {
    return false;
  }

  // summary 关键词匹配
  if (trigger.summaryMatch) {
    const summary = String(payload.summary || '').toLowerCase();
    if (!summary.includes(trigger.summaryMatch.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function buildTask(template: string, payload: Record<string, unknown>): string {
  return template
    .replace(/\{agentId\}/g, String(payload.agentId || ''))
    .replace(/\{agentName\}/g, String(payload.agentName || ''))
    .replace(/\{summary\}/g, String(payload.summary || ''))
    .replace(/\{sessionId\}/g, String(payload.sessionId || ''));
}

async function dispatchTask(action: TaskRouteAction, taskMessage: string): Promise<void> {
  try {
    const { agentExecutor } = await import('@main/ai/AgentExecutor');
    const { nanoid } = await import('nanoid');

    const sessionId = `task-router:${nanoid(8)}`;
    logger?.info?.(`[TaskRouter] Dispatching task to ${action.agentId}: ${taskMessage.substring(0, 100)}...`);

    // 通过 Pipeline 提交，自动排队处理
    agentExecutor.submitViaPipeline(sessionId, taskMessage);
  } catch (err) {
    logger?.error?.('[TaskRouter] Failed to dispatch task:', err);
  }
}

function handleAgentDone(payload: Record<string, unknown>): void {
  // 跳过 task-router 自己触发的任务，避免无限循环
  const sid = String(payload.sessionId || '');
  if (sid.startsWith('task-router:')) {
    return;
  }

  for (const route of routes) {
    if (matchRoute(route, payload)) {
      const taskMessage = buildTask(route.action.task, payload);
      const delay = route.action.delayMs ?? 2000;

      logger?.info?.(
        `[TaskRouter] Route "${route.name}" matched (agent=${payload.agentId}), dispatching in ${delay}ms`
      );

      setTimeout(() => {
        dispatchTask(route.action, taskMessage).catch((err) => {
          logger?.error?.(`[TaskRouter] Route "${route.name}" dispatch failed:`, err);
        });
      }, delay);
    }
  }
}

export default {
  id: 'task-router',
  name: 'Task Router',

  register: async (api) => {
    logger = api.logger;
    eventBusRef = api.eventBus;

    // 加载路由规则
    try {
      const { Env } = await import('@main/common/env');
      routes = await loadRoutes(Env.paths.configDir);
      logger.info(`[TaskRouter] Loaded ${routes.length} active route(s)`);
    } catch {
      routes = [];
      logger.info('[TaskRouter] No routes loaded (config not available)');
    }

    // 注册 Channel（声明式，标识存在即可）
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

    logger.info('[TaskRouter] Extension registered, listening for agent:done events');
  },

  unregister: () => {
    if (agentDoneHandler && eventBusRef) {
      eventBusRef.off('agent:done', agentDoneHandler);
      agentDoneHandler = null;
    }
    routes = [];
    logger?.info?.('[TaskRouter] Extension unregistered');
  }
} satisfies ExtensionModule;
