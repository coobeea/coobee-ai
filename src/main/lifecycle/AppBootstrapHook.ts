/**
 * App Bootstrap Hook
 *
 * 初始化应用级别的基础设置
 * - 系统托盘图标
 * - 应用图标和名称
 * - 其他全局配置
 */

import { LifecyclePhase, LifecycleContext } from '@main/common/types'
import { log } from '@main/common/logger'
import { app, nativeImage } from 'electron'

/**
 * App Bootstrap Hook
 *
 * 在应用准备就绪时初始化基础设置
 */
export const AppBootstrapHook = {
  name: 'app-bootstrap',
  phase: LifecyclePhase.READY,
  priority: 90, // 优先级高于 WindowBootstrapHook (100)
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[AppBootstrapHook] 初始化应用基础设置...')

    try {
      // 1. 设置应用名称
      app.setName('Coobee AI')
      log.info(`[AppBootstrapHook] 应用名称: ${app.getName()}`)

      // 2. 设置应用版本（从 package.json 读取）
      log.info(`[AppBootstrapHook] 应用版本: ${app.getVersion()}`)

      // 3. 初始化系统托盘
      const { trayManager } = await import('@main/common/tray')
      trayManager.createTray()

      // 4. 设置 macOS Dock 图标
      if (process.platform === 'darwin' && app.dock) {
        try {
          const { IconManager } = await import('@main/common/icons')
          const iconPath = IconManager.getAppIcon()
          const icon = nativeImage.createFromPath(iconPath)

          if (!icon.isEmpty()) {
            app.dock.setIcon(icon)
            log.info('[AppBootstrapHook] macOS Dock 图标已设置:', iconPath)
          } else {
            log.warn('[AppBootstrapHook] Dock 图标为空:', iconPath)
          }
        } catch (error) {
          log.error('[AppBootstrapHook] 设置 Dock 图标失败:', error)
        }
      }

      log.info('[AppBootstrapHook] 应用基础设置初始化完成')
    } catch (error) {
      log.error('[AppBootstrapHook] 应用基础设置初始化失败:', error)
      // 不抛出错误，允许应用继续启动（托盘不是关键功能）
    }
  }
}
