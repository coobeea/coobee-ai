import type { ExtensionModule, ExtensionApi } from '@main/common/extension';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Env } from '@main/common/env';
import { agentExecutor } from '@main/ai/AgentExecutor';

// Extension API logger (将在 register 时注入)
let logger: ExtensionApi['logger'];

/**
 * 更新任务状态（直接操作本地文件系统，即 Direct 模式）
 */
async function updateTaskStatus(taskId: string, status: string, result?: unknown): Promise<boolean> {
  const tavernDir = path.join(Env.paths.userHome, 'tavern');
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
      handler: async (ctx: { request: { body: Record<string, unknown> }; status: number; body: unknown }) => {
        try {
          const body = ctx.request.body;
          if (body && body.event === 'external.tavern.task.created' && body.task) {
            const taskObj = body.task as { id: string };
            logger?.info?.(`[TavernIntegration] Received new task event from worker: ${taskObj.id}`);

            // 将事件推入系统全局事件总线
            api.events?.emit(body.event as string, body.task);

            ctx.status = 200;
            ctx.body = { ok: true, message: 'Event received and published' };
          } else {
            ctx.status = 400;
            ctx.body = { ok: false, error: 'Invalid event payload' };
          }
        } catch (err) {
          logger?.error?.('[TavernIntegration] Error processing webhook event:', err);
          ctx.status = 500;
          ctx.body = { ok: false, error: 'Internal Server Error' };
        }
      }
    });

    // 3. MVP 调度大脑：监听事件并自动派单给 app-copilot
    api.registerService({
      id: 'tavern-task-dispatcher',
      start: () => {
        logger?.info?.('[TavernTaskDispatcher] Started. Listening for tavern tasks.');
        api.events?.on('external.tavern.task.created', async (task: unknown) => {
          const taskObj = task as { id: string; title: string; description: string };
          logger?.info?.(`[TavernTaskDispatcher] Dispatching task ${taskObj.id} to app-copilot...`);

          try {
            // 直接指定接单的 Agent
            const builder = agentExecutor.piMono();

            // 为了能让大模型处理这个任务，我们构造一个详细的 Prompt
            const prompt = `There is a new Tavern task for you to handle. 
Task ID: ${taskObj.id}
Title: ${taskObj.title}
Description:
${taskObj.description}

Please analyze this task, use the 'external_tavern_accept_task' tool to accept it, process the requirements, and then use the 'external_tavern_submit_result' tool to submit your final results.`;

            builder
              .name('app-copilot')
              .instructions(
                'You are an autonomous AI worker handling tasks from the Tavern system. You must ALWAYS accept the task first, do the work, and then submit the result. You have access to tavern tools.'
              )
              .tools([
                'external_tavern_accept_task',
                'external_tavern_submit_result'
                // 注意：这里可能需要注入 app-copilot 本身的工具（如 bash, fs_read 等），取决于你的能力需求
                // MVP 阶段为了跑通流程，我们可以注入基础的系统工具
              ])
              .maxSteps(5); // 允许它多轮思考，直到提交结果

            const sessionId = `tavern-task-${task.id}-${Date.now()}`;

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
            logger.error(`[TavernTaskDispatcher] Failed to dispatch task ${taskObj.id}:`, err);
          }
        });
      },
      stop: () => {
        logger.info('[TavernTaskDispatcher] Stopped.');
        // 取消监听。注意 ExtensionRegistry unregisterAll 时会自动清理 api.events 的监听器
      }
    });

    // 4. 注册给 Agent 使用的工具
    // 4.1 接受任务
    api.registerTool({
      name: 'external_tavern_accept_task',
      description: 'Accept a Tavern task by ID. Use this when you decide to take on a task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to accept' }
        },
        required: ['taskId']
      },
      execute: async (params) => {
        const { taskId } = params;
        const success = await updateTaskStatus(taskId, 'in-progress');
        if (success) {
          logger?.info?.(`[TavernIntegration] Agent accepted task ${taskId}`);
          return { success: true, message: `Task ${taskId} accepted successfully.` };
        }
        return { success: false, error: `Task ${taskId} not found or update failed.` };
      }
    });

    // 4.2 提交任务结果
    api.registerTool({
      name: 'external_tavern_submit_result',
      description: 'Submit the result for a Tavern task you have completed.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task being submitted' },
          textResult: { type: 'string', description: 'The text result or explanation of the completed work' },
          fileResults: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of file paths that contain the outputs'
          }
        },
        required: ['taskId', 'textResult']
      },
      execute: async (params) => {
        const { taskId, textResult, fileResults = [] } = params;
        const result = { textResult, fileResults };
        const success = await updateTaskStatus(taskId, 'completed', result);

        if (success) {
          logger?.info?.(`[TavernIntegration] Agent submitted result for task ${taskId}`);
          return { success: true, message: `Result for task ${taskId} submitted successfully.` };
        }
        return { success: false, error: `Task ${taskId} not found or update failed.` };
      }
    });
  }
} as ExtensionModule;
