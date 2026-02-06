/**
 * App Bootstrap Hook
 *
 * 初始化应用级别的基础设置
 * - 系统托盘图标
 * - 应用图标和名称
 * - 其他全局配置
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'
import { app, nativeImage } from 'electron'

/**
 * App Bootstrap Hook
 *
 * 在 READY 阶段初始化应用基础设置
 * - 设置应用名称和版本
 * - 创建托盘图标
 * - 设置 macOS Dock 图标
 */
export const ReadyAppBootstrapHook: LifecycleHook = {
  name: 'ready-app-bootstrap',
  phase: LifecyclePhase.READY,
  priority: 90, // 优先级高于 WindowBootstrapHook (100)
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyAppBootstrapHook] 初始化应用基础设置...')

    try {
      // 1. 设置应用名称
      app.setName('Coobee AI')
      log.info(`[ReadyAppBootstrapHook] 应用名称: ${app.getName()}`)

      // 2. 设置应用版本（从 package.json 读取）
      log.info(`[ReadyAppBootstrapHook] 应用版本: ${app.getVersion()}`)

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
            log.info('[ReadyAppBootstrapHook] macOS Dock 图标已设置:', iconPath)
          } else {
            log.warn('[ReadyAppBootstrapHook] Dock 图标为空:', iconPath)
          }
        } catch (error) {
          log.error('[ReadyAppBootstrapHook] 设置 Dock 图标失败:', error)
        }
      }

      log.info('[ReadyAppBootstrapHook] 应用基础设置初始化完成')
    } catch (error) {
      log.error('[ReadyAppBootstrapHook] 应用基础设置初始化失败:', error)
      // 不抛出错误，允许应用继续启动（托盘不是关键功能）
    }
  }
}
