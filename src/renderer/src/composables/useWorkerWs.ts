/**
 * Worker 领域 WebSocket 组合式
 *
 * 封装 Worker 管理频道的所有 WebSocket 交互逻辑：
 *   - 监听 Worker 状态变更（worker:status）
 *   - 获取 Worker 列表（worker:list）
 *   - 启动/停止 Worker（worker:start / worker:stop）
 *   - 重连后自动请求 Worker 状态
 *
 * 消息类型：
 *   发送：worker:list, worker:start, worker:stop
 *   接收：worker:status, worker:list
 */

import { wsService } from '@/plugins/wsSetup'
import type { WorkerStatusInfo } from '@shared/stream-protocol'

// ==================== 内部状态 ====================

/** Worker 状态回调列表（多个消费方可同时监听） */
let statusHandlers: ((info: WorkerStatusInfo) => void)[] = []
let unregisterPrefix: (() => void) | null = null
let unregisterConnect: (() => void) | null = null

// ==================== 初始化 ====================

/**
 * 初始化 worker 前缀处理器
 */
function init(): void {
  if (unregisterPrefix) return

  // 注册 worker:* 消息处理器
  unregisterPrefix = wsService.onPrefix('worker', (action, data) => {
    switch (action) {
      case 'status':
        // 单个 Worker 状态变更
        if (data) {
          const info = data as WorkerStatusInfo
          for (const handler of statusHandlers) {
            handler(info)
          }
        }
        break

      case 'list':
        // Worker 列表（连接后一次性返回所有状态）
        if (Array.isArray(data)) {
          for (const info of data) {
            for (const handler of statusHandlers) {
              handler(info as WorkerStatusInfo)
            }
          }
        }
        break
    }
  })

  // 注册连接回调：重连后自动请求 Worker 列表
  unregisterConnect = wsService.onConnect(() => {
    wsService.send({ type: 'worker:list' })
    console.log('[useWorkerWs] 重连后请求 Worker 列表')
  })
}

// 模块加载时自动初始化
init()

// ==================== 导出 API ====================

/**
 * 注册 Worker 状态变更回调
 *
 * @param handler 状态回调
 * @returns 取消注册的函数
 */
export function onWorkerStatus(handler: (info: WorkerStatusInfo) => void): () => void {
  statusHandlers.push(handler)
  return () => {
    statusHandlers = statusHandlers.filter((h) => h !== handler)
  }
}

/**
 * 启动指定 Worker
 */
export function startWorker(name: string): void {
  wsService.send({ type: 'worker:start', workerName: name })
}

/**
 * 停止指定 Worker
 */
export function stopWorker(name: string): void {
  wsService.send({ type: 'worker:stop', workerName: name })
}

/**
 * 主动请求 Worker 状态列表
 */
export function requestWorkers(): void {
  wsService.send({ type: 'worker:list' })
}

/**
 * 清理资源
 */
export function workerCleanup(): void {
  statusHandlers = []
  unregisterPrefix?.()
  unregisterConnect?.()
  unregisterPrefix = null
  unregisterConnect = null
}
