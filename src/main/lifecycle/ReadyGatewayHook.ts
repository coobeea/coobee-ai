/**
 * Gateway Hook — Gateway 初始化
 *
 * 在 READY 阶段初始化 Gateway，挂载到 HttpServer 的统一端口上，
 * 自动发现方法组和事件桥接。
 *
 * 执行顺序：
 *   ReadyApiRegistrationHook (35) → ReadyGatewayHook (45) → ReadyRuntimeHook (80)
 *
 * 前置条件：HttpServer 已初始化（由 ReadyApiRegistrationHook 完成）
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

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
      log.info('[ReadyGatewayHook] Gateway initialized successfully')
    } catch (error) {
      log.error('[ReadyGatewayHook] Failed to initialize Gateway:', error)
    }
  }
}
