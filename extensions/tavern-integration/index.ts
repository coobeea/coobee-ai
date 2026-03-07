import type { ExtensionModule, ExtensionApi } from '@main/common/extension';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ToolCategory } from '@main/ai/tools/types';
import { z } from 'zod';

// Extension API logger 和 api 引用（将在 register 时注入）
let logger: ExtensionApi['logger'];
const apiRef: ExtensionApi | null = null;

/**
 * 更新任务状态（直接操作本地文件系统，即 Direct 模式）
 */
async function updateTaskStatus(taskId: string, status: string, result?: unknown): Promise<boolean> {
  if (!apiRef) return false;

  // ✅ 通过 ExtensionApi 统一获取用户主目录
  const userHome = await apiRef.services.paths.getUserHome();
  const tavernDir = path.join(userHome, 'tavern');
  const taskMetaPath = path.join(tavernDir, 'tasks', taskId, 'meta.json');
  const tasksIndexPath = path.join(tavernDir, 'tasks.jsonl');

  let taskData: Record<string, unknown> | null = null;

  try {
    const content = await fs.readFile(taskMetaPath, 'utf-8');
    taskData = JSON.parse(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }

  if (!taskData) return false;

  taskData.status = status;
  if (result) {
    taskData.result = result;
  }
  taskData.updatedAt = new Date().toISOString();

  await fs.writeFile(taskMetaPath, JSON.stringify(taskData, null, 2), 'utf-8');

  // 更新 index
  try {
    const content = await fs.readFile(tasksIndexPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const newLines = lines.map((line) => {
      const t = JSON.parse(line);
      if (t.id === taskId) {
        return JSON.stringify(taskData);
      }
      return line;
    });
    await fs.writeFile(tasksIndexPath, newLines.join('\n') + '\n', 'utf-8');
  } catch (err) {
    logger?.error?.(`[TavernIntegration] Failed to update tasks index for task ${taskId}:`, err);
  }

  return true;
}

export default {
  id: 'tavern-integration',
  name: 'Tavern Integration',

  register: (api) => {
    // 注入 logger
    logger = api.logger;
    // 1. 注册 Channel
    api.registerChannel({
      id: 'tavern-channel',
      name: 'Tavern Channel',
      gateway: {
        start: (ctx) => {
          ctx.log.info('[TavernChannel] Channel started. Listening for worker events.');
        },
        stop: (ctx) => {
          ctx.log.info('[TavernChannel] Channel stopped.');
        }
      }
    });

    // 2. 开放内部 Webhook 接收口，用于接收 Python Worker 推送的事件
    api.registerHttpRoute({
      method: 'POST',
      path: '/internal/tavern/events',
      handler: async (ctx: Record<string, unknown>) => {
        try {
          const body = (ctx as { request: { body: Record<string, unknown> } }).request.body;
          const koaCtx = ctx as { status: number; body: unknown };
          if (body && body.event === 'external.tavern.task.created' && body.task) {
            const taskObj = body.task as { id: string };
            logger?.info?.(`[TavernIntegration] Received new task event from worker: ${taskObj.id}`);

            // 将事件推入系统全局事件总线
            api.eventBus.emit(body.event as string, body.task);

            koaCtx.status = 200;
            koaCtx.body = { ok: true, message: 'Event received and published' };
          } else {
            koaCtx.status = 400;
            koaCtx.body = { ok: false, error: 'Invalid event payload' };
          }
        } catch (err) {
          logger?.error?.('[TavernIntegration] Error processing webhook event:', err);
          const koaCtx = ctx as { status: number; body: unknown };
          koaCtx.status = 500;
          koaCtx.body = { ok: false, error: 'Internal Server Error' };
        }
      }
    });

    // 3. MVP 调度大脑：监听事件并自动派单给 app-copilot
    // 保存 handler 函数引用，用于清理
    const taskCreatedHandler = async (task: unknown): Promise<void> => {
      const taskObj = task as { id: string; title: string; description: string };
      logger?.info?.(`[TavernTaskDispatcher] Dispatching task ${taskObj.id} to app-copilot...`);

      try {
        const api: ExtensionApi | null = apiRef; // 使用局部变量并明确类型
        if (!api) {
          logger?.error?.('[TavernTaskDispatcher] ExtensionApi not available');
          return;
        }

        // ✅ 通过 ExtensionApi 统一获取依赖
        const agentExecutor = await api.services.agent.getExecutor();
        const toolRegistry = await api.services.agent.getToolRegistry();

        // 直接指定接单的 Agent
        const builder = agentExecutor.piMono();

        // 为了能让大模型处理这个任务，我们构造一个详细的 Prompt
        const prompt = `There is a new Tavern task for you to handle. 
Task ID: ${taskObj.id}
Title: ${taskObj.title}
Description:
${taskObj.description}

Please analyze this task, use the 'external_tavern_accept_task' tool to accept it, process the requirements, and then use the 'external_tavern_submit_result' tool to submit your final results.`;

        // 获取工具定义
        const tavernTools = [
          toolRegistry.get('external_tavern_accept_task'),
          toolRegistry.get('external_tavern_submit_result')
        ].filter((t): t is NonNullable<typeof t> => t !== undefined);

        builder
          .name('app-copilot')
          .instructions(
            'You are an autonomous AI worker handling tasks from the Tavern system. You must ALWAYS accept the task first, do the work, and then submit the result. You have access to tavern tools.'
          )
          .tools(tavernTools);

        const sessionId = `tavern-task-${taskObj.id}-${Date.now()}`;

        // 提交给 AgentExecutor 后台执行
        agentExecutor.submit({
          sessionId,
          message: prompt,
          builder,
          onChunk: (_chunk) => {
            // 如果需要，可以在这里把进度推送给某个通道
          }
        });
      } catch (err) {
        logger?.error?.(`[TavernTaskDispatcher] Failed to dispatch task ${taskObj.id}:`, err);
      }
    };

    api.registerService({
      id: 'tavern-task-dispatcher',
      start: () => {
        logger?.info?.('[TavernTaskDispatcher] Started. Listening for tavern tasks.');
        api.eventBus.on('external.tavern.task.created', taskCreatedHandler);
      },
      stop: () => {
        logger?.info?.('[TavernTaskDispatcher] Stopped.');
        api.eventBus.off('external.tavern.task.created', taskCreatedHandler);
      }
    });

    // 4. 注册给 Agent 使用的工具
    // 4.1 接受任务
    api.registerTool({
      name: 'external_tavern_accept_task',
      description: 'Accept a Tavern task by ID. Use this when you decide to take on a task.',
      category: ToolCategory.Extension,
      parameters: z.object({
        taskId: z.string().describe('The ID of the task to accept')
      }),
      execute: async function* (params) {
        const { taskId } = params;
        yield { type: 'progress', content: `Accepting task ${taskId}...`, percentage: 50 };

        const success = await updateTaskStatus(taskId as string, 'in-progress');
        if (success) {
          logger?.info?.(`[TavernIntegration] Agent accepted task ${taskId}`);
          return {
            success: true,
            llmContent: `Task ${taskId} accepted successfully.`
          };
        }
        return {
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: `Task ${taskId} not found or update failed.`
          }
        };
      }
    });

    // 4.2 提交任务结果
    api.registerTool({
      name: 'external_tavern_submit_result',
      description: 'Submit the result for a Tavern task you have completed.',
      category: ToolCategory.Extension,
      parameters: z.object({
        taskId: z.string().describe('The ID of the task being submitted'),
        textResult: z.string().describe('The text result or explanation of the completed work'),
        fileResults: z.array(z.string()).optional().describe('Optional list of file paths that contain the outputs')
      }),
      execute: async function* (params) {
        const { taskId, textResult, fileResults = [] } = params;
        yield { type: 'progress', content: `Submitting result for task ${taskId}...`, percentage: 50 };

        const result = { textResult, fileResults };
        const success = await updateTaskStatus(taskId as string, 'completed', result);

        if (success) {
          logger?.info?.(`[TavernIntegration] Agent submitted result for task ${taskId}`);
          return {
            success: true,
            llmContent: `Result for task ${taskId} submitted successfully.`
          };
        }
        return {
          success: false,
          error: {
            code: 'TASK_UPDATE_FAILED',
            message: `Task ${taskId} not found or update failed.`
          }
        };
      }
    });
  },

  unregister: () => {
    logger?.info?.('[TavernIntegration] Extension unregistered. Services will be stopped by ExtensionLoader.');
  }
} as ExtensionModule;
