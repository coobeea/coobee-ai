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
import type { GoalChecker } from '@main/ai/goal/types';
import { Env } from '@main/common/env';

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
  /** 启动时跳过超过此时间（ms）的 pending 任务，默认 24 小时。设为 0 表示不跳过 */
  staleThreshold?: number;
  /** 最大重试次数，超过后标记为 failed 终态，默认 3 */
  maxRetries?: number;
}

export class TaskScheduler {
  private static instance: TaskScheduler | null = null;

  private readonly pollInterval: number;
  private readonly maxConcurrent: number;
  private readonly enableNotification: boolean;
  private readonly staleThreshold: number;
  private readonly maxRetries: number;

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 是否为启动后的首次 poll（用于 stale task 检测） */
  private firstPoll = true;

  /** sessionId → TaskExecution 映射 */
  private executions = new Map<string, TaskExecution>();

  private constructor(options: TaskSchedulerOptions = {}) {
    this.pollInterval = options.pollInterval ?? 30_000;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.enableNotification = options.enableNotification ?? true;
    this.staleThreshold = options.staleThreshold ?? 24 * 60 * 60 * 1000; // 24h
    this.maxRetries = options.maxRetries ?? 3;
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
    let pendingTasks = await store.getPendingTasks();
    if (pendingTasks.length === 0) return;

    // 首次启动时，跳过过于陈旧的 pending 任务（避免重启后盲目执行历史残留）
    if (this.firstPoll && this.staleThreshold > 0) {
      this.firstPoll = false;
      const now = Date.now();
      const stale: Task[] = [];
      const fresh: Task[] = [];

      for (const task of pendingTasks) {
        const age = now - new Date(task.createdAt).getTime();
        if (age > this.staleThreshold) {
          stale.push(task);
        } else {
          fresh.push(task);
        }
      }

      if (stale.length > 0) {
        log.warn(
          `[TaskScheduler] Skipped ${stale.length} stale pending task(s) on startup: ${stale.map((t) => t.id).join(', ')}`
        );
      }

      pendingTasks = fresh;
      if (pendingTasks.length === 0) return;
    } else {
      this.firstPoll = false;
    }

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

      // 预填 GOAL.md：酒馆任务的目标文件必须包含「完成后更新酒馆任务状态」的终极目标
      await this.writeTaskGoalFile(sessionId, task);

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
      const currentTask = await store.readMeta(task.id);
      const retryCount = (currentTask?.retryCount ?? 0) + 1;
      const exhausted = retryCount >= this.maxRetries;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await store.updateTask(task.id, {
        status: exhausted ? 'failed' : 'pending',
        retryCount,
        lastError: errorMsg
      });

      if (exhausted) {
        log.error(`[TaskScheduler] Task ${task.id} permanently failed after ${retryCount} dispatch attempts`);
      }
    }
  }

  /** 将任务描述转换为 Agent 可以理解的消息 */
  private buildTaskMessage(task: Task): string {
    const retryNote =
      task.retryCount && task.retryCount > 0
        ? `\n\n> ⚠️ 这是第 ${task.retryCount + 1} 次尝试。上次失败原因: ${task.lastError || '未知'}\n> 请尝试不同的方法来完成任务。`
        : '';

    const parts = [`## 任务: ${task.title}`, '', task.description];

    if (task.files.length > 0) {
      parts.push('', '### 相关文件', ...task.files.map((f) => `- ${f}`));
    }

    parts.push(
      retryNote,
      '',
      '---',
      '请先创建 GOAL.md 记录任务目标，然后完成以上任务。完成后请总结你做了什么，以及最终产出物（如有文件产出请列出路径）。'
    );

    return parts.join('\n');
  }

  /** 为酒馆任务预填 GOAL.md（工作空间初始化后立即写入） */
  private async writeTaskGoalFile(sessionId: string, task: Task): Promise<void> {
    try {
      const { Env } = await import('@main/common/env');
      const workspace = await Env.getAgentWorkspaceDir(sessionId);
      const goalPath = await import('node:path').then((p) => p.join(workspace, 'GOAL.md'));
      const fs = await import('node:fs');

      const retryNote =
        task.retryCount && task.retryCount > 0
          ? `\n> ⚠️ 第 ${task.retryCount + 1} 次尝试。上次失败: ${task.lastError || '未知'}\n`
          : '';

      const content = `# Goal

## Original Request

> 酒馆任务 [${task.id}]: ${task.title}
${retryNote}
## Task Description

${task.description}
${task.files.length > 0 ? '\n## Related Files\n\n' + task.files.map((f) => `- ${f}`).join('\n') + '\n' : ''}
## Objectives

1. 理解并分析任务需求
2. 执行任务所需的具体操作
3. 生成任务产出物（如有）
4. **[终极目标] 任务完成后，确保酒馆任务状态被正确更新**

## Verifiable Criteria

- [ ] 任务核心需求已完成
- [ ] 产出物（如有）已保存到 output/ 目录
- [ ] 执行结果已总结
- [ ] **酒馆任务 ${task.id} 的状态已更新为 completed（通过 Tavern Skill 或系统自动完成）**

## Status

- **Phase**: Planning
- **Progress**: 任务已分配，等待执行
- **Tavern Task ID**: ${task.id}
- **Session ID**: ${sessionId}
`;

      fs.writeFileSync(goalPath, content, 'utf-8');
      log.info(`[TaskScheduler] GOAL.md written for task ${task.id} in session ${sessionId}`);
    } catch (err) {
      log.warn(`[TaskScheduler] Failed to write GOAL.md for task ${task.id}:`, err);
    }
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
    const task = await store.readMeta(taskId);
    const retryCount = (task?.retryCount ?? 0) + 1;
    const exhausted = retryCount >= this.maxRetries;

    await store.updateTask(taskId, {
      status: exhausted ? 'failed' : 'pending',
      retryCount,
      lastError: error,
      result: {
        textResult: exhausted
          ? `任务在 ${retryCount} 次尝试后最终失败: ${error}`
          : `第 ${retryCount}/${this.maxRetries} 次执行失败: ${error}，将自动重试`,
        fileResults: []
      }
    });

    if (exhausted) {
      log.error(`[TaskScheduler] Task ${taskId} permanently failed after ${retryCount} attempts: ${error}`);
      if (this.enableNotification) {
        this.sendNotification(`任务彻底失败: ${taskId}`, `已重试 ${retryCount} 次，最后错误: ${error}`);
      }
    } else {
      log.warn(`[TaskScheduler] Task ${taskId} failed (attempt ${retryCount}/${this.maxRetries}): ${error}`);
      if (this.enableNotification) {
        this.sendNotification(`任务失败: ${taskId}`, `第 ${retryCount} 次失败，将自动重试`);
      }
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

  /**
   * 目标驱动循环执行
   *
   * 持续执行任务直到目标达成或超过最大迭代次数
   *
   * @param taskId 任务 ID
   * @param goalChecker 目标检查器
   * @param maxIterations 最大迭代次数（默认 10）
   */
  async executeUntilGoal(taskId: string, goalChecker: GoalChecker, maxIterations = 10): Promise<void> {
    const store = await TavernStore.getInstance();
    const task = await store.readMeta(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    log.info(`[TaskScheduler] Starting goal-driven execution for task ${taskId} with checker: ${goalChecker.name}`);

    let iteration = 0;
    let sessionId: string | null = null;

    while (iteration < maxIterations) {
      iteration++;
      log.info(`[TaskScheduler] Goal-driven iteration ${iteration}/${maxIterations} for task ${taskId}`);

      // 每次迭代都分派任务
      if (!sessionId) {
        sessionId = await this.dispatchTaskWithSession(task);
      } else {
        await this.continueSession(sessionId, task);
      }

      // 等待任务执行完成
      await this.waitForSessionCompletion(sessionId);

      // 检查目标是否达成
      const workspace = await Env.getAgentWorkspaceDir(sessionId);
      const result = await goalChecker.check({
        sessionId,
        taskId: task.id,
        workspace,
        iteration,
        maxIterations
      });

      log.info(`[TaskScheduler] Goal check result for task ${taskId}:`, {
        achieved: result.achieved,
        progress: result.progress,
        feedback: result.feedback?.slice(0, 200)
      });

      if (result.achieved) {
        await store.updateTask(taskId, {
          status: 'completed',
          result: {
            textResult: `目标在 ${iteration} 次迭代后达成`,
            fileResults: []
          }
        });
        log.info(`[TaskScheduler] Goal achieved for task ${taskId} after ${iteration} iterations`);
        if (this.enableNotification) {
          this.sendNotification(`目标达成: ${task.title}`, `经过 ${iteration} 次迭代成功完成`);
        }
        break;
      } else {
        log.info(`[TaskScheduler] Goal not achieved yet for task ${taskId}, continuing...`);
        task.description = `${task.description}\n\n## 上一轮反馈\n\n${result.feedback || '继续尝试'}`;
      }
    }

    if (iteration >= maxIterations) {
      await store.updateTask(taskId, {
        status: 'failed',
        result: {
          textResult: `任务在 ${maxIterations} 次迭代后仍未达成目标`,
          fileResults: []
        }
      });
      log.warn(`[TaskScheduler] Task ${taskId} failed to achieve goal after ${maxIterations} iterations`);
      if (this.enableNotification) {
        this.sendNotification(`目标未达成: ${task.title}`, `已执行 ${maxIterations} 次迭代`);
      }
    }
  }

  /**
   * 分派任务并返回 sessionId（目标驱动模式使用）
   */
  private async dispatchTaskWithSession(task: Task): Promise<string> {
    const { ThreadStore } = await import('@main/ai/threads/ThreadStore');
    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.create({
      title: `[Goal-Driven] ${task.title}`,
      agentId: 'default',
      agentMode: 'agent',
      agentType: 'agent',
      metadata: {
        source: 'goal-driven-scheduler',
        taskId: task.id
      }
    });

    const sessionId = thread.id;
    const message = this.buildTaskMessage(task);
    const { agentExecutor } = await import('@main/ai/AgentExecutor');
    const result = await agentExecutor.submitViaPipeline(sessionId, message, 'agent');

    if (!result) {
      const builder = agentExecutor.createBuilderFromFactory('agent');
      if (!builder) {
        throw new Error('Neither Pipeline nor BuilderFactory is available');
      }
      agentExecutor.submit({ sessionId, message, builder });
    }

    return sessionId;
  }

  /**
   * 在同一 session 中继续任务（追加消息）
   */
  private async continueSession(sessionId: string, task: Task): Promise<void> {
    const message = this.buildTaskMessage(task);
    const { agentExecutor } = await import('@main/ai/AgentExecutor');
    const result = await agentExecutor.submitViaPipeline(sessionId, message, 'agent');

    if (!result) {
      const builder = agentExecutor.createBuilderFromFactory('agent');
      if (!builder) {
        throw new Error('Neither Pipeline nor BuilderFactory is available');
      }
      agentExecutor.submit({ sessionId, message, builder });
    }
  }

  /**
   * 等待会话完成
   */
  private async waitForSessionCompletion(sessionId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Session completion timeout'));
      }, 600000); // 10 分钟超时

      const handleEnd = (event: { sessionId: string }): void => {
        if (event.sessionId === sessionId) {
          cleanup();
          resolve();
        }
      };

      const handleError = (event: { sessionId: string; error?: string }): void => {
        if (event.sessionId === sessionId) {
          cleanup();
          reject(new Error(event.error || 'Session error'));
        }
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        eventBus.off(StreamEventType.END, handleEnd);
        eventBus.off(StreamEventType.ERROR, handleError);
      };

      eventBus.on(StreamEventType.END, handleEnd);
      eventBus.on(StreamEventType.ERROR, handleError);
    });
  }
}
