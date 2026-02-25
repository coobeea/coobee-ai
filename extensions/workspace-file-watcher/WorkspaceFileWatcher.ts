/**
 * Workspace File Watcher - 工作空间文件监控器
 *
 * 功能：
 *   - 监控 .home/workspaces/{threadId}/ 目录下的文件变化
 *   - 自动续期：任何 stream 事件都延长监控时间（60s keepalive）
 *   - 批量推送：300ms 去抖后批量推送文件变化到前端
 *   - 自动清理：60s 无事件或任务结束时自动停止监控
 *
 * 生命周期：
 *   1. 监听 EventBus 'stream:message' → 首次出现 threadId 时启动监控 + 续期
 *   2. 监听 EventBus 'stream:end' / 'stream:error' → 停止监控
 *   3. 60s keepalive 超时 → 自动停止（兜底防泄漏）
 *
 * 架构设计：
 *   - 每个 threadId 独立 FSWatcher 实例（避免跨任务污染）
 *   - Map 管理所有活跃监控（防止泄漏）
 *   - 双层 Timer（keepalive 续期 + debounce 去抖）
 */

import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { StreamEvent } from '../../src/main/ai/streaming/types';
import type { ExtensionLogger, ExtensionEventBus } from '../../src/main/common/extension';

// Lazy imports to avoid module initialization issues with jiti
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StreamEventType: any;
let log: ExtensionLogger;
let eventBus: ExtensionEventBus;

async function initDeps(logger: ExtensionLogger, bus: ExtensionEventBus): Promise<void> {
  if (StreamEventType) return;

  log = logger;
  eventBus = bus;

  const streamingModule = await import('../../src/main/ai/streaming/types');
  StreamEventType = streamingModule.StreamEventType;
}

/** 单个监控实例 */
interface WatcherInstance {
  /** chokidar FSWatcher */
  watcher: FSWatcher;
  /** 续期计时器（60s 无事件自动停止） */
  keepaliveTimer: NodeJS.Timeout;
  /** 去抖计时器（300ms 批量推送） */
  debounceTimer: NodeJS.Timeout | null;
  /** 待推送的文件变化缓冲区 */
  changedFiles: Set<string>;
  /** 监控的目录 */
  watchPath: string;
  /** 启动时间 */
  startedAt: number;
}

/** 配置选项 */
interface WatcherOptions {
  /** keepalive 超时时间（毫秒），默认 60s */
  keepaliveTimeout?: number;
  /** 去抖时间（毫秒），默认 300ms */
  debounceMs?: number;
}

export class WorkspaceFileWatcher {
  private static instance: WorkspaceFileWatcher | null = null;

  /** 活跃的监控实例 */
  private watchers = new Map<string, WatcherInstance>();

  /** 配置 */
  private keepaliveTimeout: number;
  private debounceMs: number;

  /** 是否已启动监听 EventBus */
  private listening = false;

  /** 缓存的 workspacesDir 路径（在 start() 时获取） */
  private workspacesDir: string | null = null;

  /** 是否已记录过 workspacesDir 不可用的错误（避免重复日志） */
  private workspacesDirErrorLogged = false;

  /** 保存 bound 函数引用，用于正确移除 EventBus 监听器 */
  private boundHandlers = {
    message: null as ((event: StreamEvent) => Promise<void>) | null,
    end: null as ((event: StreamEvent) => void) | null,
    error: null as ((event: StreamEvent) => void) | null
  };

  private constructor(options?: WatcherOptions) {
    this.keepaliveTimeout = options?.keepaliveTimeout ?? 60_000; // 60s
    this.debounceMs = options?.debounceMs ?? 300; // 300ms
  }

  static getInstance(options?: WatcherOptions): WorkspaceFileWatcher {
    if (!WorkspaceFileWatcher.instance) {
      WorkspaceFileWatcher.instance = new WorkspaceFileWatcher(options);
    }
    return WorkspaceFileWatcher.instance;
  }

  static resetInstance(): void {
    if (WorkspaceFileWatcher.instance) {
      WorkspaceFileWatcher.instance.stopAll();
    }
    WorkspaceFileWatcher.instance = null;
  }

  // ==================== 生命周期 ====================

  /**
   * 启动监听 EventBus 事件
   */
  async start(logger: ExtensionLogger, bus: ExtensionEventBus): Promise<void> {
    if (this.listening) return;

    // Initialize dependencies
    await initDeps(logger, bus);

    // workspacesDir 采用 lazy 获取策略：
    // Extension 在 priority 50 阶段加载，而 Env.paths 在 priority 55 (ReadyInfraHook) 才初始化。
    // 因此不在 start() 中获取，而是延迟到首次 startWatch() 时按需获取。

    // 创建 bound 函数引用（保证 on/off 使用相同引用）
    this.boundHandlers.message = this.handleStreamMessage.bind(this);
    this.boundHandlers.end = this.handleStreamEnd.bind(this);
    this.boundHandlers.error = this.handleStreamError.bind(this);

    // 监听 stream:message 事件（任何 chunk → 续期）
    eventBus.on(StreamEventType.MESSAGE, this.boundHandlers.message);

    // 监听 stream:end / stream:error 事件（任务结束 → 停止监控）
    eventBus.on(StreamEventType.END, this.boundHandlers.end);
    eventBus.on(StreamEventType.ERROR, this.boundHandlers.error);

    this.listening = true;
    log.info('[WorkspaceFileWatcher] Started listening to EventBus events');
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.listening) return;

    // 使用保存的 bound 函数引用移除监听器
    if (this.boundHandlers.message) {
      eventBus.off(StreamEventType.MESSAGE, this.boundHandlers.message);
    }
    if (this.boundHandlers.end) {
      eventBus.off(StreamEventType.END, this.boundHandlers.end);
    }
    if (this.boundHandlers.error) {
      eventBus.off(StreamEventType.ERROR, this.boundHandlers.error);
    }

    // 清空引用
    this.boundHandlers.message = null;
    this.boundHandlers.end = null;
    this.boundHandlers.error = null;

    this.stopAll();
    this.listening = false;
    log.info('[WorkspaceFileWatcher] Stopped');
  }

  /**
   * 停止所有监控（应用关闭时调用）
   */
  stopAll(): void {
    for (const [threadId] of this.watchers) {
      this.stopWatch(threadId);
    }
    log.info('[WorkspaceFileWatcher] Stopped all watchers');
  }

  // ==================== EventBus 事件处理 ====================

  /**
   * 处理 stream:message 事件
   *
   * 逻辑：
   *   1. 首次出现的 threadId → 启动监控
   *   2. 已存在的 threadId → 续期 keepalive
   */
  private async handleStreamMessage(event: StreamEvent): Promise<void> {
    const { sessionId } = event;
    if (!sessionId) return;

    // 跳过子 Agent sessionId（含 ':'）
    if (sessionId.includes(':')) return;

    if (!this.watchers.has(sessionId)) {
      // 首次出现，启动监控
      try {
        await this.startWatch(sessionId);
      } catch (err) {
        log.error(`[WorkspaceFileWatcher] Failed to start watch for ${sessionId}:`, err);
      }
    } else {
      // 已存在，续期
      this.renewKeepalive(sessionId);
    }
  }

  /**
   * 处理 stream:end 事件（run:done）
   */
  private handleStreamEnd(event: StreamEvent): void {
    const { sessionId } = event;
    if (sessionId && !sessionId.includes(':')) {
      log.info(`[WorkspaceFileWatcher] Task completed, stopping watch for ${sessionId}`);
      this.stopWatch(sessionId);
    }
  }

  /**
   * 处理 stream:error 事件（run:error）
   */
  private handleStreamError(event: StreamEvent): void {
    const { sessionId } = event;
    if (sessionId && !sessionId.includes(':')) {
      log.info(`[WorkspaceFileWatcher] Task error, stopping watch for ${sessionId}`);
      this.stopWatch(sessionId);
    }
  }

  // ==================== 监控管理 ====================

  /**
   * 启动文件监控
   */
  private async startWatch(threadId: string): Promise<void> {
    if (this.watchers.has(threadId)) {
      log.warn(`[WorkspaceFileWatcher] Watch already exists for ${threadId}`);
      return;
    }

    // Lazy 获取 workspacesDir（Env.paths 在 ReadyInfraHook priority 55 才初始化）
    if (!this.workspacesDir) {
      try {
        const envModule = await import('../../src/main/common/env');
        const Env = envModule.Env || envModule.default;
        if (Env?.paths?.workspacesDir) {
          this.workspacesDir = Env.paths.workspacesDir;
          log.info(`[WorkspaceFileWatcher] Resolved workspacesDir: ${this.workspacesDir}`);
        }
      } catch {
        // Env not available yet, will retry on next startWatch call
      }
    }

    if (!this.workspacesDir) {
      if (!this.workspacesDirErrorLogged) {
        log.warn(
          `[WorkspaceFileWatcher] workspacesDir not available yet. ` +
            `Watch request for ${threadId} skipped. Will retry on next event.`
        );
        this.workspacesDirErrorLogged = true;
      }
      return;
    }

    const watchPath = path.join(this.workspacesDir, threadId);

    const watcher = watch(watchPath, {
      ignored: [
        /(^|[/\\])\../, // 忽略隐藏文件
        /node_modules/, // 忽略 node_modules
        /\.git/ // 忽略 .git
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    watcher.on('all', (event, filePath) => {
      this.onFileChange(threadId, event, filePath);
    });

    watcher.on('error', (error) => {
      log.error(`[WorkspaceFileWatcher] Watcher error for ${threadId}:`, error);
    });

    const keepaliveTimer = this.createKeepaliveTimer(threadId);

    const instance: WatcherInstance = {
      watcher,
      keepaliveTimer,
      debounceTimer: null,
      changedFiles: new Set(),
      watchPath,
      startedAt: Date.now()
    };

    this.watchers.set(threadId, instance);
    log.info(`[WorkspaceFileWatcher] Started watching: ${threadId} (path: ${watchPath})`);
  }

  /**
   * 停止文件监控
   */
  private stopWatch(threadId: string): void {
    const instance = this.watchers.get(threadId);
    if (!instance) return;

    // 清理 keepalive timer
    clearTimeout(instance.keepaliveTimer);

    // 清理 debounce timer（如果有）
    if (instance.debounceTimer) {
      clearTimeout(instance.debounceTimer);
    }

    // 关闭 chokidar watcher
    instance.watcher.close().catch((err) => {
      log.warn(`[WorkspaceFileWatcher] Error closing watcher for ${threadId}:`, err);
    });

    this.watchers.delete(threadId);
    log.info(`[WorkspaceFileWatcher] Stopped watching: ${threadId}`);
  }

  // ==================== 续期机制 ====================

  /**
   * 续期 keepalive（任何 stream 事件都会触发）
   */
  private renewKeepalive(threadId: string): void {
    const instance = this.watchers.get(threadId);
    if (!instance) return;

    // 清除旧 timer
    clearTimeout(instance.keepaliveTimer);

    // 创建新 timer
    instance.keepaliveTimer = this.createKeepaliveTimer(threadId);
  }

  /**
   * 创建 keepalive 计时器（60s 无事件自动停止）
   */
  private createKeepaliveTimer(threadId: string): NodeJS.Timeout {
    return setTimeout(() => {
      log.info(`[WorkspaceFileWatcher] Keepalive timeout (${this.keepaliveTimeout}ms), stopping watch for ${threadId}`);
      this.stopWatch(threadId);
    }, this.keepaliveTimeout);
  }

  // ==================== 文件变化处理 ====================

  /**
   * 文件变化回调
   */
  private onFileChange(threadId: string, event: string, filePath: string): void {
    const instance = this.watchers.get(threadId);
    if (!instance) return;

    // 只关心 add/change/unlink 事件
    if (!['add', 'change', 'unlink'].includes(event)) return;

    // 计算相对路径（相对于 workspace 根目录）
    const relativePath = path.relative(instance.watchPath, filePath);

    // 添加到变化缓冲区
    instance.changedFiles.add(relativePath);

    log.debug(`[WorkspaceFileWatcher] File ${event}: ${threadId}/${relativePath}`);

    // 去抖：延迟推送
    this.scheduleFlush(threadId, instance);
  }

  /**
   * 安排推送（去抖）
   */
  private scheduleFlush(threadId: string, instance: WatcherInstance): void {
    // 清除旧 timer
    if (instance.debounceTimer) {
      clearTimeout(instance.debounceTimer);
    }

    // 创建新 timer
    instance.debounceTimer = setTimeout(() => {
      this.flushChanges(threadId, instance);
    }, this.debounceMs);
  }

  /**
   * 批量推送文件变化到前端
   */
  private flushChanges(threadId: string, instance: WatcherInstance): void {
    if (instance.changedFiles.size === 0) return;

    const files = Array.from(instance.changedFiles);
    instance.changedFiles.clear();
    instance.debounceTimer = null;

    // 推送到 EventBus（会被 StreamBridge 转发到 Gateway WebSocket）
    eventBus.emit('workspace:file-changed', {
      threadId,
      files,
      timestamp: Date.now()
    });

    log.info(`[WorkspaceFileWatcher] Pushed ${files.length} file change(s) for ${threadId}`);
  }

  // ==================== 查询方法 ====================

  /**
   * 获取活跃监控的数量
   */
  get activeWatcherCount(): number {
    return this.watchers.size;
  }

  /**
   * 检查是否正在监控某个 threadId
   */
  isWatching(threadId: string): boolean {
    return this.watchers.has(threadId);
  }

  /**
   * 获取监控信息
   */
  getWatcherInfo(threadId: string): { watchPath: string; startedAt: number; fileCount: number } | null {
    const instance = this.watchers.get(threadId);
    if (!instance) return null;

    return {
      watchPath: instance.watchPath,
      startedAt: instance.startedAt,
      fileCount: instance.changedFiles.size
    };
  }
}
