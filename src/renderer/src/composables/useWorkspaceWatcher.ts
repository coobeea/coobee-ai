/**
 * Workspace 文件监控 WebSocket 组合式
 *
 * 监听 Gateway 推送的 workspace.file-changed 事件，实时通知文件变化。
 * 用于：
 *   - 刷新文件树
 *   - 高亮变化的文件
 *   - 自动重载打开的文件
 */

import { gateway } from '@/plugins/gatewaySetup';

// ==================== 类型定义 ====================

export interface WorkspaceFileChangedPayload {
  threadId: string;
  files: string[];
  timestamp: number;
}

export type WorkspaceFileChangeHandler = (payload: WorkspaceFileChangedPayload) => void;

// ==================== 内部状态 ====================

/** 文件变化回调列表（多个消费方可同时监听） */
const fileChangeHandlers: Map<string, WorkspaceFileChangeHandler[]> = new Map();
let unregisterFileChanged: (() => void) | null = null;
let initialized = false;

// ==================== 初始化 ====================

/**
 * 初始化 workspace 事件监听
 */
function init(): void {
  if (initialized) return;
  initialized = true;

  // 监听 workspace.file-changed 事件
  unregisterFileChanged = gateway.on('workspace.file-changed', (payload) => {
    if (!payload) return;

    const data = payload as WorkspaceFileChangedPayload;
    if (!data.threadId || !data.files || data.files.length === 0) return;

    // 调用该 threadId 的所有处理器
    const handlers = fileChangeHandlers.get(data.threadId);
    if (!handlers || handlers.length === 0) return;

    console.log(`[useWorkspaceWatcher] 文件变化: ${data.threadId}, ${data.files.length} 个文件`);

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error('[useWorkspaceWatcher] Handler error:', err);
      }
    }
  });

  console.log('[useWorkspaceWatcher] 初始化完成');
}

// ==================== 导出 API ====================

/**
 * 订阅指定 threadId 的文件变化
 *
 * @param threadId - 要监听的任务 ID
 * @param handler - 文件变化处理函数
 * @returns 取消订阅函数
 */
export function watchThreadFiles(threadId: string, handler: WorkspaceFileChangeHandler): () => void {
  // 确保已初始化
  if (!initialized) init();

  // 获取或创建该 threadId 的处理器列表
  if (!fileChangeHandlers.has(threadId)) {
    fileChangeHandlers.set(threadId, []);
  }

  const handlers = fileChangeHandlers.get(threadId)!;
  handlers.push(handler);

  console.log(`[useWorkspaceWatcher] 开始监听: ${threadId} (${handlers.length} 个处理器)`);

  // 返回取消订阅函数
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }

    // 如果该 threadId 没有处理器了，清理 Map
    if (handlers.length === 0) {
      fileChangeHandlers.delete(threadId);
    }

    console.log(`[useWorkspaceWatcher] 停止监听: ${threadId}`);
  };
}

/**
 * 清理所有订阅（组件卸载时调用）
 */
export function cleanupWorkspaceWatcher(): void {
  if (unregisterFileChanged) {
    unregisterFileChanged();
    unregisterFileChanged = null;
  }

  fileChangeHandlers.clear();
  initialized = false;

  console.log('[useWorkspaceWatcher] 清理完成');
}

// 模块加载时自动初始化
init();
