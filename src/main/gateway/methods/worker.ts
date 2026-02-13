/**
 * Gateway Worker 方法组
 *
 * 对应旧 WorkerChannel 的客户端请求处理部分。
 * 状态推送部分在 events/StreamBridge.ts 处理。
 *
 * 方法：
 *   worker.list  — 获取所有 Worker 状态
 *   worker.start — 启动指定 Worker
 *   worker.stop  — 停止指定 Worker
 */

import { log } from '@main/common/logger'
import { RuntimeManager } from '@main/runtime'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'

export const workerMethods: MethodGroup = {
  namespace: 'worker',
  methods: {
    list: async () => {
      const allWorkers = RuntimeManager.getInstance().getAllWorkerInfo()
      return { workers: allWorkers }
    },

    start: async (params) => {
      const { name } = params as { name?: string }
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required')
      }

      log.info(`[worker.start] Starting worker: ${name}`)
      try {
        await RuntimeManager.getInstance().start(name)
        return { ok: true, name }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error(`[worker.start] Failed: ${name}`, error)
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg)
      }
    },

    stop: async (params) => {
      const { name } = params as { name?: string }
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required')
      }

      log.info(`[worker.stop] Stopping worker: ${name}`)
      try {
        await RuntimeManager.getInstance().stop(name)
        return { ok: true, name }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error(`[worker.stop] Failed: ${name}`, error)
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg)
      }
    }
  }
}
