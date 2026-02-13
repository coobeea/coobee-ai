/**
 * Runtime Hook — Worker 子进程管理
 *
 * READY 阶段：扫描 workers/ 目录自动发现并注册所有 Worker，
 *            异步启动 autoStart 的 Worker（不阻塞主进程）。
 *
 * BEFORE_QUIT 阶段：优雅关闭所有 Worker 子进程。
 *
 * 扩展方式：在 workers/ 下新建目录，放入 worker.json + server.py，
 *          无需改动任何 TypeScript 代码。
 */

import { log } from '@main/common/logger'
import { RuntimeManager } from '@main/runtime'
import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'

/**
 * READY 阶段 Hook：扫描 + 注册 + 异步启动
 */
export const ReadyRuntimeHook: LifecycleHook = {
  name: 'ready-runtime',
  phase: LifecyclePhase.READY,
  priority: 80, // 较低优先级，窗口和 API 先准备好
  critical: false, // 非关键，Worker 启动失败不阻断 app

  async execute(_context: LifecycleContext): Promise<void> {
    const manager = RuntimeManager.getInstance()

    // 自动扫描 workers/ 目录，发现并注册所有 Worker
    const count = manager.scanAndRegister()

    if (count === 0) {
      log.info('[ReadyRuntimeHook] 未发现任何 Worker')
      return
    }

    // 异步启动 autoStart 的 Worker（不 await，不阻塞）
    const configs = manager.getRegisteredWorkers()
    const autoStartWorkers = configs.filter((c) => c.autoStart)

    if (autoStartWorkers.length > 0) {
      log.info(
        `[ReadyRuntimeHook] 后台启动 Worker: ${autoStartWorkers.map((c) => c.name).join(', ')}`
      )

      for (const config of autoStartWorkers) {
        manager.start(config.name).catch((err) => {
          log.error(`[ReadyRuntimeHook] Worker "${config.name}" 后台启动失败:`, err)
        })
      }
    } else {
      log.info('[ReadyRuntimeHook] 无 autoStart Worker，等待按需启动')
    }
  }
}

/**
 * BEFORE_QUIT 阶段 Hook：优雅关闭所有 Worker
 */
export const BeforeQuitRuntimeHook: LifecycleHook = {
  name: 'before-quit-runtime',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10, // 高优先级，尽早开始停止子进程
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[BeforeQuitRuntimeHook] 正在关闭所有 Worker...')
    const manager = RuntimeManager.getInstance()
    await manager.stopAll()
    log.info('[BeforeQuitRuntimeHook] 所有 Worker 已关闭')
  }
}
