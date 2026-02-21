/**
 * Tavern HTTP 路由
 *
 * 提供酒馆任务系统的 HTTP API。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/tavern/tasks           — 获取任务列表
 *   GET    /gateway/tavern/tasks/:id       — 获取任务详情
 *   POST   /gateway/tavern/tasks           — 发布新任务
 *   PATCH  /gateway/tavern/tasks/:id       — 更新任务状态
 *   DELETE /gateway/tavern/tasks/:id       — 删除任务
 *
 * 数据存储：
 *   - 使用文件系统存储
 *   - 目录结构：~/.coobee-ai/tavern/
 *     - tasks.json（任务列表索引）
 *     - tasks/[taskId]/（每个任务一个文件夹）
 *       - meta.json（任务元数据）
 *       - files/（附件文件）
 */

import * as fs from 'fs';
import * as path from 'path';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { nanoid } from 'nanoid';
import { Env } from '@main/common/env';

const log = createLogger('gateway-http-tavern');

export interface TaskResult {
  textResult: string;
  fileResults: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  amount: number;
  files: string[];
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';
  result?: TaskResult;
  createdAt: string;
  updatedAt: string;
}

// 获取酒馆数据目录
function getTavernDir(): string {
  return path.join(Env.paths.userHome, 'tavern');
}

// 获取任务列表文件路径
function getTasksIndexPath(): string {
  return path.join(getTavernDir(), 'tasks.json');
}

// 获取任务文件夹路径
function getTaskDir(taskId: string): string {
  return path.join(getTavernDir(), 'tasks', taskId);
}

// 确保目录存在
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (err) {
    log.error(`Failed to create directory ${dirPath}:`, err);
    throw err;
  }
}

// 读取任务列表索引
async function readTasksIndex(): Promise<Task[]> {
  const indexPath = getTasksIndexPath();
  try {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as Task[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

// 写入任务列表索引
async function writeTasksIndex(tasks: Task[]): Promise<void> {
  await ensureDir(getTavernDir());
  const indexPath = getTasksIndexPath();
  await fs.promises.writeFile(indexPath, JSON.stringify(tasks, null, 2), 'utf-8');
}

// 读取任务元数据
async function readTaskMeta(taskId: string): Promise<Task | null> {
  const metaPath = path.join(getTaskDir(taskId), 'meta.json');
  try {
    const content = await fs.promises.readFile(metaPath, 'utf-8');
    return JSON.parse(content) as Task;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

// 写入任务元数据
async function writeTaskMeta(taskId: string, task: Task): Promise<void> {
  const taskDir = getTaskDir(taskId);
  await ensureDir(taskDir);
  const metaPath = path.join(taskDir, 'meta.json');
  await fs.promises.writeFile(metaPath, JSON.stringify(task, null, 2), 'utf-8');
}

export function registerTavernRoutes(router: Router): void {
  // 获取任务列表
  router.get('/tavern/tasks', async (ctx) => {
    try {
      const tasks = await readTasksIndex();
      // 按创建时间倒序排列
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      ctx.body = { tasks };
    } catch (err) {
      log.error('Failed to get tasks:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to load tasks' };
    }
  });

  // 获取任务详情
  router.get('/tavern/tasks/:id', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const task = await readTaskMeta(taskId);
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

  // 发布新任务
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

      // 创建任务
      const taskId = nanoid();
      const now = new Date().toISOString();

      // 文件路径列表（前端传递文件路径引用）
      const filePaths = filePathsInput || [];

      const task: Task = {
        id: taskId,
        title,
        description,
        amount,
        files: filePaths,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };

      // 写入任务元数据
      await writeTaskMeta(taskId, task);

      // 更新任务列表索引
      const tasks = await readTasksIndex();
      tasks.push(task);
      await writeTasksIndex(tasks);

      log.info(`Task created: ${taskId}`);
      ctx.body = { task };
    } catch (err) {
      log.error('Failed to create task:', err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to create task' };
    }
  });

  // 更新任务状态和结果
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

      const task = await readTaskMeta(taskId);
      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }

      // 更新状态
      if (status) {
        task.status = status;
      }

      // 更新结果
      if (result) {
        task.result = result;
      }

      task.updatedAt = new Date().toISOString();

      await writeTaskMeta(taskId, task);

      // 更新索引
      const tasks = await readTasksIndex();
      const index = tasks.findIndex((t) => t.id === taskId);
      if (index >= 0) {
        tasks[index] = task;
        await writeTasksIndex(tasks);
      }

      log.info(`Task updated: ${taskId}${status ? `, status: ${status}` : ''}${result ? ', result updated' : ''}`);
      ctx.body = { task };
    } catch (err) {
      log.error(`Failed to update task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to update task' };
    }
  });

  // 删除任务
  router.delete('/tavern/tasks/:id', async (ctx) => {
    const taskId = ctx.params.id;
    if (!taskId) {
      ctx.status = 400;
      ctx.body = { error: 'Task ID is required' };
      return;
    }

    try {
      const task = await readTaskMeta(taskId);
      if (!task) {
        ctx.status = 404;
        ctx.body = { error: 'Task not found' };
        return;
      }

      // 删除任务文件夹
      const taskDir = getTaskDir(taskId);
      await fs.promises.rm(taskDir, { recursive: true, force: true });

      // 从索引中移除
      const tasks = await readTasksIndex();
      const filtered = tasks.filter((t) => t.id !== taskId);
      await writeTasksIndex(filtered);

      log.info(`Task deleted: ${taskId}`);
      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to delete task ${taskId}:`, err);
      ctx.status = 500;
      ctx.body = { error: 'Failed to delete task' };
    }
  });
}
