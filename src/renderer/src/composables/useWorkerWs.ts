/**
 * Worker 领域 WebSocket 组合式
 *
 * 封装 Worker 管理的所有交互逻辑：
 *   - 监听 Worker 状态变更（worker.status 事件）
 *   - 获取 Worker 列表（worker.list RPC）
 *   - 启动/停止 Worker（worker.start / worker.stop RPC）
 *   - 重连后自动请求 Worker 状态
 *
 * RPC 方法：
 *   worker.list   — 获取 Worker 列表
 *   worker.start  — 启动指定 Worker
 *   worker.stop   — 停止指定 Worker
 *
 * 事件：
 *   worker.status — Worker 状态变更推送
 */

import { gateway } from '@/plugins/gatewaySetup';
import type { WorkerStatusInfo } from '@shared/stream-protocol';

// ==================== 内部状态 ====================

/** Worker 状态回调列表（多个消费方可同时监听） */
let statusHandlers: ((info: WorkerStatusInfo) => void)[] = [];
let unregisterStatus: (() => void) | null = null;
let unregisterConnect: (() => void) | null = null;

// ==================== 初始化 ====================

/**
 * 初始化 worker 事件监听
 */
function init(): void {
  if (unregisterStatus) return;

  // 监听 worker.status 事件
  unregisterStatus = gateway.on('worker.status', (payload) => {
    if (payload) {
      const info = payload as WorkerStatusInfo;
      for (const handler of statusHandlers) {
        handler(info);
      }
    }
  });

  // 注册连接回调：重连后自动请求 Worker 列表
  unregisterConnect = gateway.onConnect(() => {
    fetchWorkerList();
  });

  // 初始化时也立即请求一次（WebSocket 可能已经连接）
  setTimeout(() => fetchWorkerList(), 500);
}

function fetchWorkerList(): void {
  gateway
    .request<{ workers: WorkerStatusInfo[] } | WorkerStatusInfo[]>('worker.list')
    .then((result) => {
      const list = Array.isArray(result) ? result : ((result as { workers?: WorkerStatusInfo[] })?.workers ?? []);
      for (const info of list) {
        for (const handler of statusHandlers) {
          handler(info);
        }
      }
    })
    .catch(() => {
      // WebSocket 尚未就绪时静默
    });
}

// 模块加载时自动初始化
init();

// ==================== 导出 API ====================

/**
 * 注册 Worker 状态变更回调
 *
 * @param handler 状态回调
 * @returns 取消注册的函数
 */
export function onWorkerStatus(handler: (info: WorkerStatusInfo) => void): () => void {
  statusHandlers.push(handler);
  return () => {
    statusHandlers = statusHandlers.filter((h) => h !== handler);
  };
}

/**
 * 启动指定 Worker
 */
export function startWorker(name: string): void {
  gateway
    .request('worker.start', { name })
    .catch((err) => console.error(`[useWorkerWs] 启动 Worker ${name} 失败:`, err));
}

/**
 * 停止指定 Worker
 */
export function stopWorker(name: string): void {
  gateway
    .request('worker.stop', { name })
    .catch((err) => console.error(`[useWorkerWs] 停止 Worker ${name} 失败:`, err));
}

/**
 * 主动请求 Worker 状态列表
 */
export function requestWorkers(): void {
  fetchWorkerList();
}

/**
 * 清理资源
 */
export function workerCleanup(): void {
  statusHandlers = [];
  unregisterStatus?.();
  unregisterConnect?.();
  unregisterStatus = null;
  unregisterConnect = null;
}
