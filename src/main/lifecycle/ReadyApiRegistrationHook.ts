/**
 * API Registration Hook — HTTP + IPC 服务初始化
 *
 * 初始化 HttpServer（统一端口）和 IpcServer，
 * 使 src/main/api/ 下的模块被 loader 自动发现和注册。
 *
 * 执行顺序：
 *   ReadyApiRegistrationHook (35) → ReadyGatewayHook (45) → 窗口创建 (100)
 *
 * 必须在 Gateway 之前执行，因为 GatewayServer 需要挂载到 HttpServer 的 http.Server 上。
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

export const ReadyApiRegistrationHook: LifecycleHook = {
  name: 'ready-api-registration',
  phase: LifecyclePhase.READY,
  priority: 35, // 在 Gateway(45) 之前，确保 HttpServer 已就绪
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyApiRegistrationHook] Initializing server modules (HttpServer + IpcServer)...')

    try {
      const { initializeServerModules } = await import('@main/common/server')
      initializeServerModules()
      log.info('[ReadyApiRegistrationHook] Server modules initialized successfully')
    } catch (error) {
      log.error('[ReadyApiRegistrationHook] Failed to initialize server modules:', error)
    }
  }
}
