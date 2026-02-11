/**
 * API Registration Hook
 *
 * 初始化 API 路由系统（IpcServer + 可选 HttpServer）
 * 使 src/main/api/ 下的模块被 loader 自动发现和注册
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * API Registration Hook
 *
 * 在 READY 阶段初始化 API 路由系统
 * 命名规范：导出变量名必须以 'Hook' 结尾以便自动扫描
 */
export const ReadyApiRegistrationHook: LifecycleHook = {
  name: 'ready-api-registration',
  phase: LifecyclePhase.READY,
  priority: 55, // 在 IPC 注册(50) 之后、窗口创建(100) 之前
  critical: false, // API 路由失败不应阻断启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyApiRegistrationHook] Initializing API server modules...')

    try {
      // 动态导入以避免循环依赖
      const { initializeServerModules } = await import('@main/common/server')

      // 初始化 API 路由系统（自动扫描 src/main/api/ 下的模块）
      initializeServerModules()

      log.info('[ReadyApiRegistrationHook] API server modules initialized successfully')
    } catch (error) {
      log.error('[ReadyApiRegistrationHook] Failed to initialize API server modules:', error)
      // 不抛出错误，API 服务失败不应阻断启动
    }
  }
}
