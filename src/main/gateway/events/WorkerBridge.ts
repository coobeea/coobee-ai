/**
 * Gateway 事件桥接 — Worker
 *
 * 将 WorkerManager 的状态变更事件转换为 Gateway 事件推送。
 *
 * 桥接映射：
 *   WorkerManager worker:status → Gateway event 'worker.status'（广播所有客户端）
 */

import { log } from '@main/common/logger'
import { WorkerManager } from '@main/common/worker'
import type { WorkerStatusInfo } from '@shared/stream-protocol'
import type { EventBridgeInit } from '../protocol'

export const initWorkerBridge: EventBridgeInit = (gateway) => {
  const manager = WorkerManager.getInstance()

  manager.on('worker:status', (event: { worker: WorkerStatusInfo }) => {
    gateway.broadcastEvent('worker.status', event.worker)

    log.debug(`[WorkerBridge] Worker 状态推送: ${event.worker.name} → ${event.worker.status}`)
  })

  log.info('[WorkerBridge] Worker 事件桥接初始化完成')
}
