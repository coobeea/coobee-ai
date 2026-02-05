/**
 * 托盘管理器
 * 管理系统托盘图标和菜单
 */

import { Menu, Tray, app } from 'electron'
import { log } from './logger'
import { getTrayNativeImage } from './icons'
import { config } from './config'
import { eventBus } from './eventbus'
import { EventTypes } from '@shared/ipc/events'

class TrayManager {
  private tray: Tray | null = null

  /**
   * 初始化托盘
   */
  createTray(): void {
    try {
      // 检查是否启用托盘
      if (!config.getShowTrayIcon()) {
        log.info('[TrayManager] 托盘图标显示已禁用，跳过托盘创建')
        return
      }

      // 避免重复创建
      if (this.tray) {
        log.warn('[TrayManager] 托盘已存在，跳过创建')
        return
      }

      // 获取托盘图标（通过 IconManager 统一管理，内置错误处理）
      const trayIcon = getTrayNativeImage()

      // 创建托盘
      this.tray = new Tray(trayIcon)
      this.tray.setToolTip('Coobee AI')

      // 设置菜单
      this.updateMenu()

      // 点击托盘图标时显示主窗口
      this.tray.on('click', async () => {
        log.debug('[TrayManager] 托盘图标被点击')
        // 动态导入 windowManager 避免循环依赖
        const { windowManager } = await import('./window')
        const mainWindow = windowManager.getMainWindow()
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      })

      // 监听配置变更，动态更新托盘菜单
      this.setupConfigListeners()

      log.info('[TrayManager] 托盘初始化成功')
    } catch (error) {
      log.error('[TrayManager] 托盘初始化失败:', error)
    }
  }

  /**
   * 设置配置监听器
   */
  private setupConfigListeners(): void {
    // 监听托盘图标显示配置变更
    eventBus.on(EventTypes.CONFIG_SHOW_TRAY_ICON_CHANGED, (payload) => {
      log.info(`[TrayManager] 托盘图标显示配置变更: ${payload.value}`)
      if (payload.value) {
        this.recreate()
      } else {
        this.destroy()
      }
    })

    // 监听其他配置变更，更新菜单
    eventBus.on(EventTypes.CONFIG_AUTO_START_CHANGED, () => this.updateMenu())
    eventBus.on(EventTypes.CONFIG_CLOSE_TO_TRAY_CHANGED, () => this.updateMenu())
  }

  /**
   * 更新托盘菜单
   */
  updateMenu(): void {
    if (!this.tray) return

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: '显示主窗口',
        click: async () => {
          const { windowManager } = await import('./window')
          const mainWindow = windowManager.getMainWindow()
          if (mainWindow) {
            if (mainWindow.isMinimized()) {
              mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: '开机启动',
        type: 'checkbox',
        checked: config.getAutoStart(),
        click: (menuItem) => {
          config.setAutoStart(menuItem.checked)
          // 设置开机启动
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            openAsHidden: config.getStartToTray()
          })
        }
      },
      {
        label: '关闭时最小化到托盘',
        type: 'checkbox',
        checked: config.getCloseToTray(),
        click: (menuItem) => {
          config.setCloseToTray(menuItem.checked)
        }
      },
      { type: 'separator' },
      {
        label: `关于 Coobee AI`,
        click: async () => {
          // TODO: 显示关于对话框
          log.info('[TrayManager] 显示关于对话框')
          const { dialog } = await import('electron')
          dialog.showMessageBox({
            type: 'info',
            title: '关于 Coobee AI',
            message: 'Coobee AI',
            detail: `版本: ${app.getVersion()}\n\n一个智能 AI 助手应用`
          })
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          log.info('[TrayManager] 用户从托盘菜单退出应用')
          // 设置标志，表示是主动退出
          app.quit()
        }
      }
    ]

    const contextMenu = Menu.buildFromTemplate(menuTemplate)
    this.tray.setContextMenu(contextMenu)
  }

  /**
   * 销毁托盘
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      log.info('[TrayManager] 托盘已销毁')
    }
  }

  /**
   * 重新创建托盘
   */
  recreate(): void {
    this.destroy()
    this.createTray()
  }

  /**
   * 检查托盘是否已创建
   */
  isCreated(): boolean {
    return this.tray !== null
  }

  /**
   * 获取托盘实例
   */
  getTray(): Tray | null {
    return this.tray
  }
}

// 创建单例实例
export const trayManager = new TrayManager()
