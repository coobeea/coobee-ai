/**
 * Tavern HTTP 路由
 *
 * 提供酒馆任务系统的 HTTP API。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/tavern/tasks              — 获取任务列表
 *   GET    /gateway/tavern/tasks/:id          — 获取任务详情
 *   POST   /gateway/tavern/tasks              — 发布新任务
 *   PATCH  /gateway/tavern/tasks/:id          — 更新任务状态
 *   DELETE /gateway/tavern/tasks/:id          — 删除任务
 *   GET    /gateway/tavern/scheduler/status   — TaskScheduler 运行状态
 *   POST   /gateway/tavern/scheduler/start    — 启动 TaskScheduler
 *   POST   /gateway/tavern/scheduler/stop     — 停止 TaskScheduler
 *
 * 存储层委托给 TavernStore（src/main/ai/tavern/TavernStore.ts）。
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { nanoid } from 'nanoid';
import { TavernStore, type Task, type TaskResult } from '@main/ai/tavern/TavernStore';
import { TaskScheduler } from '@main/ai/tavern/TaskScheduler';

const log = createLogger('gateway-http-tavern');

export type { Task, TaskResult };

export function registerTavernRoutes(router: Router): void {
  router.get('/tavern/tasks', async (ctx) => {
    try {
      const store = await TavernStore.getInstance();
      const tasks = await store.readIndex();
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      ctx.body = { tasks };
    } catch (err) {
      log.error('Failed to get tasks:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to load tasks' };
    }
  });

  router.get('/tavern/tasks/:id', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const store = await TavernStore.getInstance();
      const task = await store.readMeta(taskId);
      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }
      ctx.body = { task };
    } catch (err) {
      log.error(`Failed to get task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to load task' };
    }
  });

  router.post('/tavern/tasks', async (ctx) => {
    try {
      const body = ctx.request.body as Record<string, unknown>;

      const title = body.title as string | undefined;
      const description = body.description as string | undefined;
      const amount = body.amount as number | undefined;
      const filePathsInput = body.filePaths as string[] | undefined;

      if (!title || !description || !amount) {
        ctx.status = 400;
        ctx.body = { error: 'title, description, and amount are required' };
        return;
      }

      if (amount <= 0) {
        ctx.status = 400;
        ctx.body = { error: 'amount must be a positive number' };
        return;
      }

      const taskId = nanoid();
      const now = new Date().toISOString();
      const filePaths = filePathsInput || [];
      const config = body.config as Task['config'] | undefined;
      const agentId = body.agentId as string | undefined;
      const executionMode = body.executionMode as Task['executionMode'] | undefined;

      const task: Task = {
        id: taskId,
        title,
        description,
        amount,
        files: filePaths,
        agentId: agentId || 'default',
        executionMode: executionMode || 'agent',
        status: 'pending',
        config,
        createdAt: now,
        updatedAt: now
      };

      const store = await TavernStore.getInstance();
      await store.writeMeta(taskId, task);
      await store.appendToIndex(task);

      log.info(`Task created: ${taskId}`);
      ctx.body = { task };
    } catch (err) {
      log.error('Failed to create task:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to create task' };
    }
  });

  router.patch('/tavern/tasks/:id', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const status = body.status as Task['status'] | undefined;
      const result = body.result as TaskResult | undefined;

      const store = await TavernStore.getInstance();
      const task = await store.readMeta(taskId);
      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }

      if (status) task.status = status;
      if (result) task.result = result;
      task.updatedAt = new Date().toISOString();

      await store.writeMeta(taskId, task);

      const tasks = await store.readIndex();
      const index = tasks.findIndex((t) => t.id === taskId);
      if (index >= 0) {
        tasks[index] = task;
        await store.writeIndex(tasks);
      }

      log.info(`Task updated: ${taskId}${status ? `, status: ${status}` : ''}${result ? ', result updated' : ''}`);
      ctx.body = { task };
    } catch (err) {
      log.error(`Failed to update task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to update task' };
    }
  });

  router.delete('/tavern/tasks/:id', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const store = await TavernStore.getInstance();
      const task = await store.readMeta(taskId);
      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }

      await store.deleteTask(taskId);

      log.info(`Task deleted: ${taskId}`);
      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to delete task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to delete task' };
    }
  });

  // 继续执行任务（用户补充资料后）
  router.post('/tavern/tasks/:id/continue', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const body = ctx.request.body as Record<string, unknown>;
      const userInputs = body.userInputs as Record<string, unknown> | undefined;

      const store = await TavernStore.getInstance();
      const task = await store.readMeta(taskId);

      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }

      if (task.status !== 'awaiting-input') {
        ctx.status = 400;
        ctx.body = { error: 'Task is not awaiting input' };
        return;
      }

      if (!task.threadId) {
        ctx.status = 400;
        ctx.body = { error: 'Task has no associated session' };
        return;
      }

      // 保存用户输入
      await store.updateTask(taskId, {
        status: 'in-progress',
        userInputs,
        awaitingInputSince: undefined
      });

      // 构造"继续执行"消息
      const inputsText = userInputs
        ? Object.entries(userInputs)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n')
        : '';

      const message = `# 继续执行任务

用户已补充以下资料：

${inputsText || '（无补充资料）'}

---

请继续执行任务，从方案设计阶段开始（或从你中断的地方继续）。

请先读取 \`lifecycle/\` 目录中已完成的文档，了解当前进度，然后继续未完成的阶段。
`;

      // 发送消息到 Agent
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const builder = agentExecutor.createBuilderFromFactory('agent');
      if (!builder) {
        throw new Error('AgentExecutor builder not available');
      }

      agentExecutor.submit({
        sessionId: task.threadId,
        message,
        builder
      });

      log.info(`Task ${taskId} resumed with user inputs`);
      ctx.body = { success: true, task };
    } catch (err) {
      log.error(`Failed to continue task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to continue task' };
    }
  });

  // ==================== TaskScheduler 管理 ====================

  router.get('/tavern/scheduler/status', (ctx) => {
    const scheduler = TaskScheduler.getInstance();
    ctx.body = {
      running: scheduler.isRunning(),
      activeExecutions: scheduler.getActiveExecutions()
    };
  });

  router.post('/tavern/scheduler/start', (ctx) => {
    const scheduler = TaskScheduler.getInstance();
    scheduler.start();
    ctx.body = { success: true, running: scheduler.isRunning() };
  });

  router.post('/tavern/scheduler/stop', (ctx) => {
    const scheduler = TaskScheduler.getInstance();
    scheduler.stop();
    ctx.body = { success: true, running: scheduler.isRunning() };
  });
}
