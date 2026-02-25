/**
 * TaskScheduler - 自主任务调度器
 *
 * Phase 4 核心组件：轮询 Tavern 中的 pending 任务，自动创建 Thread 并分发给 AgentExecutor 执行。
 *
 * 设计：
 *   - 轮询间隔可配（默认 30s）
 *   - 并发控制：同时最多执行 N 个任务（默认 1）
 *   - 任务完成后通过 stream:end 事件感知，更新 Tavern 任务状态
 *   - 发送 Electron Notification 通知用户
 *   - 主进程运行，前端关闭不影响执行
 */

import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { StreamEventType } from '@main/ai/streaming/types';
import { TavernStore, type Task } from './TavernStore';

const log = createLogger('task-scheduler');

interface TaskExecution {
  taskId: string;
  threadId: string;
  sessionId: string;
  startedAt: number;
}

export interface TaskSchedulerOptions {
  /** 轮询间隔（ms），默认 30000 */
  pollInterval?: number;
  /** 最大并发任务数，默认 1 */
  maxConcurrent?: number;
  /** 是否发送系统通知，默认 true */
  enableNotification?: boolean;
}

export class TaskScheduler {
  private static instance: TaskScheduler | null = null;

  private readonly pollInterval: number;
  private readonly maxConcurrent: number;
  private readonly enableNotification: boolean;

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** sessionId → TaskExecution 映射 */
  private executions = new Map<string, TaskExecution>();

  private constructor(options: TaskSchedulerOptions = {}) {
    this.pollInterval = options.pollInterval ?? 30_000;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.enableNotification = options.enableNotification ?? true;
  }

  static getInstance(options?: TaskSchedulerOptions): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler(options);
    }
    return TaskScheduler.instance;
  }

  /** 仅供测试 */
  static resetInstance(): void {
    TaskScheduler.instance?.stop();
    TaskScheduler.instance = null;
  }

  start(): void {
    if (this.running) {
      log.info('[TaskScheduler] Already running');
      return;
    }

    this.running = true;
    this.listenForCompletion();

    this.timer = setInterval(() => {
      this.poll().catch((err) => log.error('[TaskScheduler] Poll error:', err));
    }, this.pollInterval);

    // 立即执行一次
    this.poll().catch((err) => log.error('[TaskScheduler] Initial poll error:', err));

    log.info(`[TaskScheduler] Started (interval=${this.pollInterval}ms, maxConcurrent=${this.maxConcurrent})`);
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    eventBus.removeAllListeners('task-scheduler:session-end');
    log.info('[TaskScheduler] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getActiveExecutions(): TaskExecution[] {
    return Array.from(this.executions.values());
  }

  /** 主轮询逻辑 */
  private async poll(): Promise<void> {
    if (this.executions.size >= this.maxConcurrent) {
      log.debug(`[TaskScheduler] At capacity (${this.executions.size}/${this.maxConcurrent}), skipping poll`);
      return;
    }

    const store = await TavernStore.getInstance();
    const pendingTasks = await store.getPendingTasks();
    if (pendingTasks.length === 0) return;

    const slotsAvailable = this.maxConcurrent - this.executions.size;
    const tasksToDispatch = pendingTasks.slice(0, slotsAvailable);

    for (const task of tasksToDispatch) {
      await this.dispatchTask(task);
    }
  }

  /** 分发单个任务 */
  private async dispatchTask(task: Task): Promise<void> {
    try {
      log.info(`[TaskScheduler] Dispatching task: ${task.id} - ${task.title}`);

      const store = await TavernStore.getInstance();
      await store.updateTask(task.id, { status: 'in-progress' });

      const { ThreadStore } = await import('@main/ai/threads/ThreadStore');
      const threadStore = await ThreadStore.getInstance();
      const thread = await threadStore.create({
        title: `[Task] ${task.title}`,
        agentId: 'default',
        agentMode: 'agent',
        agentType: 'agent',
        metadata: {
          source: 'task-scheduler',
          taskId: task.id
        }
      });

      const sessionId = thread.id;

      await store.updateTask(task.id, { threadId: sessionId });

      const execution: TaskExecution = {
        taskId: task.id,
        threadId: sessionId,
        sessionId,
        startedAt: Date.now()
      };
      this.executions.set(sessionId, execution);

      const message = this.buildTaskMessage(task);
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const result = await agentExecutor.submitViaPipeline(sessionId, message, 'agent');

      if (!result) {
        log.warn(`[TaskScheduler] Pipeline not ready, using direct submit for task ${task.id}`);
        const builder = agentExecutor.createBuilderFromFactory('agent');
        if (!builder) {
          throw new Error('Neither Pipeline nor BuilderFactory is available');
        }
        agentExecutor.submit({ sessionId, message, builder });
      }

      log.info(`[TaskScheduler] Task ${task.id} dispatched to session ${sessionId}`);
    } catch (err) {
      log.error(`[TaskScheduler] Failed to dispatch task ${task.id}:`, err);
      const store = await TavernStore.getInstance();
      await store.updateTask(task.id, { status: 'pending' });
    }
  }

  /** 将任务描述转换为 Agent 可以理解的消息 */
  private buildTaskMessage(task: Task): string {
    const parts = [`## 任务: ${task.title}`, '', task.description];

    if (task.files.length > 0) {
      parts.push('', '### 相关文件', ...task.files.map((f) => `- ${f}`));
    }

    parts.push('', '---', '请完成以上任务。完成后请总结你做了什么，以及最终产出物（如有文件产出请列出路径）。');

    return parts.join('\n');
  }

  /** 监听 stream:end 事件，识别任务执行完成 */
  private listenForCompletion(): void {
    eventBus.on(StreamEventType.END, (event: { sessionId: string }) => {
      const execution = this.executions.get(event.sessionId);
      if (!execution) return;

      this.handleTaskCompletion(execution).catch((err) =>
        log.error(`[TaskScheduler] Completion handler error for task ${execution.taskId}:`, err)
      );
    });

    eventBus.on(StreamEventType.ERROR, (event: { sessionId: string; error?: string }) => {
      const execution = this.executions.get(event.sessionId);
      if (!execution) return;

      this.handleTaskError(execution, event.error || 'Unknown error').catch((err) =>
        log.error(`[TaskScheduler] Error handler error for task ${execution.taskId}:`, err)
      );
    });
  }

  private async handleTaskCompletion(execution: TaskExecution): Promise<void> {
    const { taskId, sessionId } = execution;
    this.executions.delete(sessionId);

    const store = await TavernStore.getInstance();
    const duration = Math.round((Date.now() - execution.startedAt) / 1000);

    await store.updateTask(taskId, {
      status: 'completed',
      result: {
        textResult: `任务在 ${duration}s 内完成，详见会话 ${sessionId}`,
        fileResults: []
      }
    });

    log.info(`[TaskScheduler] Task ${taskId} completed (${duration}s)`);

    if (this.enableNotification) {
      this.sendNotification(`任务完成: ${taskId}`, `耗时 ${duration}s`);
    }

    eventBus.emit('task-scheduler:task-done', { taskId, sessionId, duration });
  }

  private async handleTaskError(execution: TaskExecution, error: string): Promise<void> {
    const { taskId, sessionId } = execution;
    this.executions.delete(sessionId);

    const store = await TavernStore.getInstance();
    await store.updateTask(taskId, {
      status: 'pending',
      result: {
        textResult: `执行失败: ${error}`,
        fileResults: []
      }
    });

    log.warn(`[TaskScheduler] Task ${taskId} failed: ${error}`);

    if (this.enableNotification) {
      this.sendNotification(`任务失败: ${taskId}`, error);
    }
  }

  private sendNotification(title: string, body: string): void {
    import('electron')
      .then(({ Notification }) => {
        if (Notification.isSupported()) {
          new Notification({ title, body }).show();
        }
      })
      .catch(() => {
        log.debug('[TaskScheduler] Notification not available');
      });
  }
}
