/**
 * Window Bootstrap Hook
 *
 * Creates the main window when the application is ready
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * Window Bootstrap Hook
 *
 * 在 READY 阶段创建主窗口
 * Naming convention: Export variable name must end with 'Hook' for auto-discovery
 */
export const ReadyWindowBootstrapHook: LifecycleHook = {
  name: 'ready-window-bootstrap',
  phase: LifecyclePhase.READY,
  priority: 400,
  critical: true,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyWindowBootstrapHook] Creating main window...')

    try {
      // Dynamic import to avoid circular dependencies
      const { windowManager } = await import('@main/common/window')

      // Create Shell window (main AI chat window)
      // Use default preset configuration for 'agent' window
      const mainWindow = await windowManager.createWindow({
        type: 'agent'
      })

      if (mainWindow) {
        log.info(
          `[ReadyWindowBootstrapHook] Main window created successfully: windowId=${mainWindow.id}`
        )
      } else {
        throw new Error('Failed to create main window')
      }
    } catch (error) {
      log.error('[ReadyWindowBootstrapHook] Failed to create main window:', error)
      throw error
    }
  }
}
