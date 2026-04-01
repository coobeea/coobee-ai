/**
 * LifecycleMonitor - 生命周期监控器
 *
 * 职责：
 * 1. 监听 lifecycle/*.md 文件的创建和修改
 * 2. 监听 agent:event 事件（Agent 主动通知）
 * 3. 检测阶段切换，推送进度到前端
 * 4. 超时保护（单阶段 10 分钟）
 * 5. awaiting-input 超时保护（24 小时自动取消）
 */

import * as fs from 'node:fs';
import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { TavernStore } from '../TavernStore';
import { FILE_TO_STAGE_MAP, STAGE_NAMES } from './templates';
import type { StageChangedEvent } from '../types';

const log = createLogger('lifecycle-monitor');

export class LifecycleMonitor {
  private watcher: fs.FSWatcher | null = null;
  private eventListener: ((data: unknown) => void) | null = null;
  private stageTimer: NodeJS.Timeout | null = null;
  private awaitingInputTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly taskId: string,
    private readonly lifecycleDir: string
  ) {}

  /**
   * 启动监控
   */
  start(): void {
    log.info(`[LifecycleMonitor] Starting monitor for task ${this.taskId}`);

    // 1. 监听文件变化
    this.startFileWatcher();

    // 2. 监听 Agent 事件
    this.startEventListener();

    // 3. 启动阶段超时计时器
    this.startStageTimeout();

    log.info(`[LifecycleMonitor] Monitor started for task ${this.taskId}`);
  }

  /**
   * 停止监控
   */
  stop(): void {
    log.info(`[LifecycleMonitor] Stopping monitor for task ${this.taskId}`);

    // 清理文件监听器
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // 清理事件监听器
    if (this.eventListener) {
      eventBus.off('agent:event', this.eventListener);
      this.eventListener = null;
    }

    // 清理超时计时器
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }

    if (this.awaitingInputTimer) {
      clearTimeout(this.awaitingInputTimer);
      this.awaitingInputTimer = null;
    }

    log.info(`[LifecycleMonitor] Monitor stopped for task ${this.taskId}`);
  }

  /**
   * 启动文件监听
   */
  private startFileWatcher(): void {
    try {
      this.watcher = fs.watch(this.lifecycleDir, (event, filename) => {
        if (event === 'change' && filename && filename.endsWith('.md')) {
          this.onFileChange(filename).catch((err) => {
            log.error(`[LifecycleMonitor] Error handling file change for ${filename}:`, err);
          });
        }
      });

      log.debug(`[LifecycleMonitor] File watcher started for ${this.lifecycleDir}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to start file watcher:`, err);
    }
  }

  /**
   * 启动事件监听
   */
  private startEventListener(): void {
    this.eventListener = (data: unknown) => {
      const eventData = data as Record<string, unknown>;

      // 只处理当前 sessionId 的事件
      if (eventData.sessionId !== this.sessionId) return;

      // 处理阶段通知
      if (eventData._event === 'notify' && typeof eventData.message === 'string') {
        if (eventData.message.includes('完成') && eventData.message.includes('阶段')) {
          this.onStageNotify(eventData.message).catch((err) => {
            log.error(`[LifecycleMonitor] Error handling stage notify:`, err);
          });
        }
      }

      // 处理 awaiting-input 事件
      if (eventData._event === 'tavern:awaiting-input') {
        this.onAwaitingInput(eventData).catch((err) => {
          log.error(`[LifecycleMonitor] Error handling awaiting-input:`, err);
        });
      }
    };

    eventBus.on('agent:event', this.eventListener);
    log.debug(`[LifecycleMonitor] Event listener started`);
  }

  /**
   * 文件变化处理
   */
  private async onFileChange(filename: string): Promise<void> {
    log.debug(`[LifecycleMonitor] File changed: ${filename}`);

    const stage = FILE_TO_STAGE_MAP[filename];
    if (!stage) {
      log.debug(`[LifecycleMonitor] File ${filename} is not a stage file, ignoring`);
      return;
    }

    // 读取文件内容，检查是否真的有内容（不是空模板）
    const filePath = `${this.lifecycleDir}/${filename}`;
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      log.warn(`[LifecycleMonitor] Failed to read ${filename}:`, err);
      return;
    }

    // 简单判断：如果内容很短（< 500 字符），可能只是模板
    if (content.length < 500) {
      log.debug(`[LifecycleMonitor] File ${filename} content too short, might be template only`);
      return;
    }

    log.info(`[LifecycleMonitor] Task ${this.taskId} entered stage: ${stage} (from file ${filename})`);

    // 更新任务状态
    await this.updateTaskStage(stage);

    // 推送阶段变化事件
    this.emitStageChanged(stage, filename);

    // 推送进度事件
    this.emitProgress('document-created', `完成了文档：${filename}`, filename);

    // 重置超时计时器
    this.resetStageTimeout();
  }

  /**
   * 处理 Agent 阶段通知
   */
  private async onStageNotify(message: string): Promise<void> {
    log.info(`[LifecycleMonitor] Received stage notify: ${message}`);

    // 从消息中提取阶段名称
    // 示例消息："任务「xxx」完成需求分析阶段"
    let detectedStage: string | null = null;

    for (const [stage, name] of Object.entries(STAGE_NAMES)) {
      if (message.includes(name)) {
        detectedStage = stage;
        break;
      }
    }

    if (!detectedStage) {
      log.debug(`[LifecycleMonitor] Could not detect stage from message: ${message}`);
      return;
    }

    // 更新任务状态
    await this.updateTaskStage(detectedStage);

    // 重置超时计时器
    this.resetStageTimeout();
  }

  /**
   * 处理 awaiting-input 事件
   */
  private async onAwaitingInput(_data: unknown): Promise<void> {
    log.info(`[LifecycleMonitor] Task ${this.taskId} awaiting input`);

    const store = await TavernStore.getInstance();
    await store.updateTask(this.taskId, {
      status: 'awaiting-input',
      awaitingInputSince: Date.now()
    });

    // 发送通知到前端
    eventBus.emit('agent:event', {
      _event: 'notify',
      message: `任务「${this.taskId}」需要补充资料`,
      level: 'warning'
    });

    // 启动 awaiting-input 超时计时器
    this.startAwaitingInputTimeout();

    // 暂停阶段超时计时器
    this.pauseStageTimeout();
  }

  /**
   * 更新任务阶段
   */
  private async updateTaskStage(stage: string): Promise<void> {
    try {
      const store = await TavernStore.getInstance();
      await store.updateTask(this.taskId, {
        lifecycleStage: stage
      });
      log.debug(`[LifecycleMonitor] Task ${this.taskId} stage updated to: ${stage}`);
    } catch (err) {
      log.error(`[LifecycleMonitor] Failed to update task stage:`, err);
    }
  }

  /**
   * 推送阶段变化事件
   */
  private emitStageChanged(stage: string, file: string): void {
    const event: StageChangedEvent = {
      taskId: this.taskId,
      stage: stage as StageChangedEvent['stage'],
      stageName: STAGE_NAMES[stage] || stage,
      file,
      timestamp: Date.now()
    };

    eventBus.emit('tavern:stage-changed', event);
    log.debug(`[LifecycleMonitor] Emitted stage-changed event:`, event);
  }

  /**
   * 推送进度事件
   */
  private emitProgress(
    type: 'todo-completed' | 'document-created' | 'bug-reported' | 'stage-completed',
    message: string,
    file?: string
  ): void {
    const event = {
      taskId: this.taskId,
      type,
      message,
      file,
      timestamp: Date.now()
    };

    eventBus.emit('tavern:progress', event);
    log.debug(`[LifecycleMonitor] Emitted progress event:`, event);
  }

  /**
   * 启动阶段超时计时器
   */
  private startStageTimeout(): void {
    this.stageTimer = setTimeout(
      () => {
        log.warn(`[LifecycleMonitor] Task ${this.taskId} stage timeout (10 minutes)`);

        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `任务「${this.taskId}」当前阶段执行超时（超过 10 分钟）`,
          level: 'warning'
        });

        // 超时后重新启动计时器（持续监控）
        this.startStageTimeout();
      },
      10 * 60 * 1000
    ); // 10 分钟

    log.debug(`[LifecycleMonitor] Stage timeout timer started (10 min)`);
  }

  /**
   * 重置阶段超时计时器
   */
  private resetStageTimeout(): void {
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
    this.startStageTimeout();
    log.debug(`[LifecycleMonitor] Stage timeout timer reset`);
  }

  /**
   * 暂停阶段超时计时器（awaiting-input 状态）
   */
  private pauseStageTimeout(): void {
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
      log.debug(`[LifecycleMonitor] Stage timeout timer paused`);
    }
  }

  /**
   * 启动 awaiting-input 超时计时器
   */
  private startAwaitingInputTimeout(): void {
    // 12 小时提醒
    const reminderTimer = setTimeout(
      () => {
        log.info(`[LifecycleMonitor] Task ${this.taskId} awaiting input for 12 hours, sending reminder`);

        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `任务「${this.taskId}」等待补充资料已 12 小时，请及时处理`,
          level: 'info'
        });
      },
      12 * 60 * 60 * 1000
    );

    // 24 小时自动取消
    this.awaitingInputTimer = setTimeout(
      async () => {
        log.warn(`[LifecycleMonitor] Task ${this.taskId} awaiting input for 24 hours, auto-cancelling`);

        const store = await TavernStore.getInstance();
        await store.updateTask(this.taskId, {
          status: 'cancelled',
          lastError: '用户 24 小时内未补充资料，任务已自动取消'
        });

        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `任务「${this.taskId}」因长时间未补充资料已自动取消`,
          level: 'warning'
        });

        // 清理提醒计时器
        clearTimeout(reminderTimer);

        // 停止监控
        this.stop();
      },
      24 * 60 * 60 * 1000
    );

    log.debug(`[LifecycleMonitor] Awaiting-input timeout timer started (24h with 12h reminder)`);
  }
}
