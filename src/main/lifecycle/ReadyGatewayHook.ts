/**
 * Gateway Hook — Gateway 初始化
 *
 * 在 READY 阶段初始化 Gateway，挂载到 HttpServer 的统一端口上，
 * 自动发现方法组和事件桥接。
 *
 * 执行顺序：
 *   ReadyApiRegistrationHook (35) → ReadyGatewayHook (45) → ReadyWorkerHook (80)
 *
 * 前置条件：HttpServer 已初始化（由 ReadyApiRegistrationHook 完成）
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/** 模块级引用，供退出时清理 */
let activeGateway: { close(): void } | null = null

export const ReadyGatewayHook: LifecycleHook = {
  name: 'ready-gateway',
  phase: LifecyclePhase.READY,
  priority: 45, // 在 HttpServer(35) 之后
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyGatewayHook] Initializing Gateway...')

    try {
      const { Gateway } = await import('@main/gateway')
      const gateway = new Gateway()
      gateway.start()
      activeGateway = gateway
      log.info('[ReadyGatewayHook] Gateway initialized successfully')
    } catch (error) {
      log.error('[ReadyGatewayHook] Failed to initialize Gateway:', error)
    }
  }
}

/**
 * 退出时关闭 Gateway WebSocket 服务
 */
export const BeforeQuitGatewayHook: LifecycleHook = {
  name: 'before-quit-gateway',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 20, // 最早清理网络连接
  critical: false,

  async execute(): Promise<void> {
    if (activeGateway) {
      activeGateway.close()
      activeGateway = null
      log.info('[BeforeQuitGatewayHook] Gateway closed')
    }
  }
}
