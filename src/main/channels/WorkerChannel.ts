/**
 * Worker 管理频道（Worker Channel）
 *
 * 前缀：worker
 * 职责：
 *   - 监听 RuntimeManager 的 worker:status 事件，广播给所有 WebSocket 客户端
 *   - 处理 list/start/stop 等客户端请求
 *
 * 消息类型：
 *   客户端 → 服务端：worker:list, worker:start, worker:stop
 *   服务端 → 客户端：worker:status, worker:list
 */

import { log } from '@main/common/logger'
import { RuntimeManager } from '@main/runtime'
import type {
  WsChannel,
  WsHubApi,
  WsClientMessage,
  WsServerMessage,
  WorkerStatusInfo
} from '@shared/stream-protocol'

// ==================== WorkerChannel ====================

class WorkerChannelImpl implements WsChannel {
  readonly prefix = 'worker'
  readonly label = 'Worker 管理'

  private hub!: WsHubApi

  onInit(hub: WsHubApi): void {
    this.hub = hub
    this.registerRuntimeListeners()
    log.info('[WorkerChannel] 初始化完成')
  }

  async onMessage(
    ws: unknown,
    action: string,
    msg: WsClientMessage,
    _meta: Record<string, unknown>
  ): Promise<void> {
    switch (action) {
      case 'list': {
        // 返回所有 Worker 当前状态
        const allWorkers = RuntimeManager.getInstance().getAllWorkerInfo()
        this.hub.send(ws, {
          type: 'worker:list',
          data: allWorkers
        } satisfies WsServerMessage)
        break
      }

      case 'start': {
        const name = msg.workerName
        if (name) {
          log.info(`[WorkerChannel] 启动 Worker: ${name}`)
          RuntimeManager.getInstance()
            .start(name)
            .catch((err) => {
              log.error(`[WorkerChannel] Worker "${name}" 启动失败:`, err)
            })
        }
        break
      }

      case 'stop': {
        const stopName = msg.workerName
        if (stopName) {
          log.info(`[WorkerChannel] 停止 Worker: ${stopName}`)
          RuntimeManager.getInstance()
            .stop(stopName)
            .catch((err) => {
              log.error(`[WorkerChannel] Worker "${stopName}" 停止失败:`, err)
            })
        }
        break
      }

      default:
        log.warn(`[WorkerChannel] 未知 action: ${action}`)
    }
  }

  // ==================== RuntimeManager 事件监听 ====================

  /**
   * 监听 RuntimeManager 的 worker:status 事件
   *
   * Worker 状态变更时，向所有 WebSocket 客户端广播 worker:status 消息。
   * 前端收到 ready + port 后，可直连 Worker 的 WebSocket/HTTP 端口。
   */
  private registerRuntimeListeners(): void {
    const runtime = RuntimeManager.getInstance()

    runtime.on('worker:status', (event: { worker: WorkerStatusInfo }) => {
      const msg: WsServerMessage = {
        type: 'worker:status',
        data: event.worker
      }

      // 广播给所有连接的客户端（不限 session）
      this.hub.broadcast(msg)

      log.info(
        `[WorkerChannel] Worker 状态: ${event.worker.name} → ${event.worker.status}` +
          (event.worker.port ? ` (port: ${event.worker.port})` : '')
      )
    })

    log.info('[WorkerChannel] RuntimeManager 监听已注册')
  }
}

/** 导出单例（供 WsHub 自动发现） */
export const workerChannel = new WorkerChannelImpl()
