import { log } from '../common/logger'
import { LifecycleHook, LifecyclePhase, LifecycleContext } from '../common/types'

/**
 * 后台进程清理 Hook
 * 在应用退出前清理所有通过 exec(background) 启动的后台进程
 * 防止游离进程浪费系统资源
 */
export const BeforeQuitProcessHook: LifecycleHook = {
  name: 'before-quit-process-cleanup',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 50, // 比数据库清理(100)更早执行
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      // 延迟导入避免循环依赖
      const { ProcessRegistry } = await import('../ai/tools/builtin/ProcessRegistry')
      const registry = ProcessRegistry.getInstance()

      const runningCount = registry.runningCount
      if (runningCount > 0) {
        log.info(`[BeforeQuitProcessHook] 正在清理 ${runningCount} 个运行中的后台进程...`)
      }

      registry.cleanup()
      log.info('[BeforeQuitProcessHook] 后台进程清理完成')
    } catch (error) {
      log.error('[BeforeQuitProcessHook] 后台进程清理失败:', error)
    }
  }
}
