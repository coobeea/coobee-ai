/**
 * WsHub Hook — WebSocket 消息总线初始化
 *
 * 在 READY 阶段初始化 WsHub，将 WebSocket 挂载到 HttpServer 的统一端口上，
 * 并自动发现加载所有 Channel。
 *
 * 执行顺序：
 *   ReadyApiRegistrationHook (35) → ReadyWsHubHook (40) → ReadyRuntimeHook (80)
 *
 * 前置条件：HttpServer 已初始化（由 ReadyApiRegistrationHook 完成）
 *
 * WsHub 初始化流程：
 *   1. 从 HttpServer 单例获取 http.Server
 *   2. 创建 WsServer 并挂载（通过 HTTP Upgrade 共享端口）
 *   3. 扫描 src/main/channels/*Channel.ts 自动发现 Channel
 *   4. 调用每个 Channel 的 onInit(hub)
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

export const ReadyWsHubHook: LifecycleHook = {
  name: 'ready-ws-hub',
  phase: LifecyclePhase.READY,
  priority: 40, // 在 HttpServer(35) 之后，确保 http.Server 已就绪
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyWsHubHook] Initializing WsHub (attach to HttpServer)...')

    try {
      const { wsHub } = await import('@main/common/server/WsHub')
      wsHub.initialize()
      log.info('[ReadyWsHubHook] WsHub initialized successfully')
    } catch (error) {
      log.error('[ReadyWsHubHook] Failed to initialize WsHub:', error)
    }
  }
}
