/**
 * WsHub Hook — WebSocket 消息总线初始化
 *
 * 在 READY 阶段初始化 WsHub，自动发现并加载所有 Channel。
 * 替代原来的 ReadyStreamingHook（仅初始化 WebSocketBroadcaster）。
 *
 * 执行顺序：
 *   ReadyWsHubHook (40) → IPC 注册 (50) → ReadyRuntimeHook (80)
 *
 * WsHub 初始化流程：
 *   1. 启动 WsServer（监听 VITE_WS_PORT，默认 8765）
 *   2. 扫描 src/main/channels/*Channel.ts 自动发现 Channel
 *   3. 调用每个 Channel 的 onInit(hub)
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * READY 阶段 Hook：初始化 WsHub
 */
export const ReadyWsHubHook: LifecycleHook = {
  name: 'ready-ws-hub',
  phase: LifecyclePhase.READY,
  priority: 40, // 在 IPC 注册(50) 之前，确保 WebSocket 通道就绪
  critical: false, // WebSocket 服务失败不应阻断启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyWsHubHook] Initializing WsHub...')

    try {
      // 动态导入以避免循环依赖
      const { wsHub } = await import('@main/common/server/WsHub')

      // 初始化（端口由 WsHub 内部通过 VITE_WS_PORT 配置，默认 8765）
      wsHub.initialize()

      log.info('[ReadyWsHubHook] WsHub initialized successfully')
    } catch (error) {
      log.error('[ReadyWsHubHook] Failed to initialize WsHub:', error)
      // 不抛出错误，WebSocket 服务失败不应阻断启动
    }
  }
}
