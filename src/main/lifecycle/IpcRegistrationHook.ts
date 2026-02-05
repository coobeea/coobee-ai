/**
 * IPC Registration Hook
 *
 * 注册所有 IPC 处理器（shell:*、window:*、tab:* 等）
 * 在应用就绪后、窗口创建前执行
 */

import { LifecyclePhase, LifecycleContext } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * IPC Registration Hook
 *
 * 命名规范：导出变量名必须以 'Hook' 结尾以便自动扫描
 */
export const IpcRegistrationHook = {
  name: 'ipc-registration',
  phase: LifecyclePhase.READY,
  priority: 50, // 优先级低于 WindowBootstrapHook(100)，确保在窗口创建前注册
  critical: true, // 标记为关键 Hook，失败时中断启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[IpcRegistrationHook] Registering IPC handlers...')

    try {
      // 动态导入以避免循环依赖
      const { registerIpcHandlers } = await import('@main/common/ipc')

      // 注册所有 IPC 处理器
      registerIpcHandlers()

      log.info('[IpcRegistrationHook] All IPC handlers registered successfully')
    } catch (error) {
      log.error('[IpcRegistrationHook] Failed to register IPC handlers:', error)
      throw error
    }
  }
}
