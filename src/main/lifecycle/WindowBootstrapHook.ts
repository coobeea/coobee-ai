/**
 * Window Bootstrap Hook
 *
 * Creates the main window when the application is ready
 */

import { LifecyclePhase, LifecycleContext } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * Window Bootstrap Hook
 *
 * Naming convention: Export variable name must end with 'Hook' for auto-discovery
 */
export const WindowBootstrapHook = {
  name: 'window-bootstrap',
  phase: LifecyclePhase.READY,
  priority: 100,
  critical: true,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[WindowBootstrapHook] Creating main window...')

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
          `[WindowBootstrapHook] Main window created successfully: windowId=${mainWindow.id}`
        )
      } else {
        throw new Error('Failed to create main window')
      }
    } catch (error) {
      log.error('[WindowBootstrapHook] Failed to create main window:', error)
      throw error
    }
  }
}
