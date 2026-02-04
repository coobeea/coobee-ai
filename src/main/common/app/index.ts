import { app, ipcMain, BrowserWindow } from 'electron'
import { electronApp } from '@electron-toolkit/utils'

import { log } from '../logger'
import { LifecycleManager } from '../lifecycle'
import { LifecyclePhase } from '../types'
import type { IAppManager } from './types'
import { ElectronAppEvents } from './types'

// 导入 eventBus 以触发自动初始化（构造函数会自动执行）
import '../eventbus'

/**
 * 应用管理器
 * 管理整个应用的生命周期和核心功能
 */
export class AppManager implements IAppManager {
  private lifecycleManager: LifecycleManager

  constructor() {
    this.lifecycleManager = new LifecycleManager()
    this.setupAppEventHandlers()
  }

  /**
   * 注册 IPC 处理器（供渲染进程拉取数据）
   */
  private setupIpcHandlers(): void {
    ipcMain.handle('shell:get-window-id', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win ? win.id : 0
    })
  }

  /**
   * 设置应用级别的事件处理器
   */
  private setupAppEventHandlers(): void {
    // 所有窗口关闭
    app.on(ElectronAppEvents.WINDOW_ALL_CLOSED, () => {
      log.info('[App] 所有窗口已关闭')
      // 在 macOS 上，除非用户明确退出（Cmd + Q），否则应用会保持活动状态
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    // macOS 激活应用
    app.on(ElectronAppEvents.ACTIVATE, () => {
      log.info('[App] 应用被激活')
      // 通常在 macOS 上，点击 dock 图标时会触发此事件
      // 窗口创建逻辑由其他模块通过生命周期 Hook 处理
    })

    // 应用退出前清理
    app.on(ElectronAppEvents.BEFORE_QUIT, async () => {
      log.info('[App] 应用准备退出，开始清理资源...')
      await this.cleanup()
    })
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    try {
      log.info('[App] 开始初始化应用...')

      // 1. 应用基础配置
      electronApp.setAppUserModelId('com.electron')
      log.info('[App] 应用基础配置完成')

      // 2. 触发 INIT 阶段生命周期（供其他模块使用）
      await this.lifecycleManager.executePhase(LifecyclePhase.INIT)

      // 等待应用准备就绪
      await app.whenReady()

      // 3. 触发 READY 阶段生命周期（供其他模块使用）
      await this.lifecycleManager.executePhase(LifecyclePhase.READY)

      // 4. 注册 IPC：渲染进程拉取当前窗口 ID
      this.setupIpcHandlers()

      log.info('[App] 应用初始化完成')
    } catch (error) {
      log.error('[App] 应用初始化失败:', error)
      throw error
    }
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    try {
      // 触发 BEFORE_QUIT 阶段生命周期（供其他模块清理资源）
      await this.lifecycleManager.executePhase(LifecyclePhase.BEFORE_QUIT)

      log.info('[App] 资源清理完成')
    } catch (error) {
      log.error('[App] 资源清理失败:', error)
    }
  }

  /**
   * 获取生命周期管理器
   */
  getLifecycleManager(): LifecycleManager {
    return this.lifecycleManager
  }
}

// 不要在模块加载时创建实例，避免在 app ready 前写日志
// export const appManager = new AppManager()
export default AppManager
