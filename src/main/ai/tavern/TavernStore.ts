/**
 * TavernStore - 酒馆任务持久化存储
 *
 * 从 gateway/http/tavern.ts 中抽取的存储层，供 TaskScheduler 和 HTTP 路由共用。
 *
 * 存储结构：
 *   ~/.coobee-ai/tavern/
 *   ├── tasks.jsonl       （任务索引，每行一个 JSON）
 *   └── tasks/{taskId}/
 *       └── meta.json     （任务完整元数据）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';

const log = createLogger('tavern-store');

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
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled' | 'failed';
  result?: TaskResult;
  /** 关联的 threadId（TaskScheduler 分配执行后写入） */
  threadId?: string;
  /** 已重试次数（TaskScheduler 失败后递增） */
  retryCount?: number;
  /** 最后一次失败的错误信息 */
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export class TavernStore {
  private static instance: TavernStore | null = null;
  private tavernDir!: string;

  static async getInstance(): Promise<TavernStore> {
    if (!TavernStore.instance) {
      const { Env } = await import('@main/common/env');
      const store = new TavernStore();
      store.tavernDir = path.join(Env.paths.userHome, 'tavern');
      TavernStore.instance = store;
    }
    return TavernStore.instance;
  }

  /** 仅供测试 */
  static resetInstance(): void {
    TavernStore.instance = null;
  }

  private get indexPath(): string {
    return path.join(this.tavernDir, 'tasks.jsonl');
  }

  private taskDir(taskId: string): string {
    return path.join(this.tavernDir, 'tasks', taskId);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async readIndex(): Promise<Task[]> {
    try {
      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line) as Task);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async writeIndex(tasks: Task[]): Promise<void> {
    await this.ensureDir(this.tavernDir);
    const lines = tasks.map((task) => JSON.stringify(task)).join('\n');
    await fs.promises.writeFile(this.indexPath, lines + (tasks.length > 0 ? '\n' : ''), 'utf-8');
  }

  async appendToIndex(task: Task): Promise<void> {
    await this.ensureDir(this.tavernDir);
    const line = JSON.stringify(task) + '\n';
    await fs.promises.appendFile(this.indexPath, line, 'utf-8');
  }

  async readMeta(taskId: string): Promise<Task | null> {
    const metaPath = path.join(this.taskDir(taskId), 'meta.json');
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

  async writeMeta(taskId: string, task: Task): Promise<void> {
    const dir = this.taskDir(taskId);
    await this.ensureDir(dir);
    const metaPath = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaPath, JSON.stringify(task, null, 2), 'utf-8');
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, 'status' | 'result' | 'threadId' | 'retryCount' | 'lastError'>>
  ): Promise<Task | null> {
    const task = await this.readMeta(taskId);
    if (!task) return null;

    if (updates.status) task.status = updates.status;
    if (updates.result) task.result = updates.result;
    if (updates.threadId) task.threadId = updates.threadId;
    if (updates.retryCount !== undefined) task.retryCount = updates.retryCount;
    if (updates.lastError !== undefined) task.lastError = updates.lastError;
    task.updatedAt = new Date().toISOString();

    await this.writeMeta(taskId, task);

    const tasks = await this.readIndex();
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      tasks[idx] = task;
      await this.writeIndex(tasks);
    }

    log.info(`[TavernStore] Task ${taskId} updated: status=${task.status}`);
    return task;
  }

  /** 获取所有 pending 状态的任务（按创建时间升序，先进先出） */
  async getPendingTasks(): Promise<Task[]> {
    const tasks = await this.readIndex();
    return tasks
      .filter((t) => t.status === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async deleteTask(taskId: string): Promise<void> {
    const dir = this.taskDir(taskId);
    await fs.promises.rm(dir, { recursive: true, force: true });

    const tasks = await this.readIndex();
    const filtered = tasks.filter((t) => t.id !== taskId);
    await this.writeIndex(filtered);
  }
}
