/**
 * 窗口管理器（统一管理窗口和 Tab）
 *
 * 职责：
 * - 创建和管理 BrowserWindow
 * - 创建和管理 WebContentsView（Tab）
 * - 窗口生命周期管理
 * - Tab 生命周期管理
 * - 窗口状态跟踪
 * - 窗口事件处理
 * - Tab 事件处理
 */

import { BrowserWindow, WebContentsView } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
// @ts-ignore - electron-window-state 没有类型定义
import windowStateKeeper from 'electron-window-state'
import type {
  WindowConfig,
  WindowInfo,
  WindowState,
  WindowBounds,
  WindowType,
  TabConfig,
  TabInfo,
  TabViewInfo,
  IWindowManager
} from './types'
import { getWindowPresets, CHROME_HEIGHT, BrowserWindowEvents } from './types'
import { log } from '@main/common/logger'
import { Env } from '@main/common/env'

export class WindowManager implements IWindowManager {
  // ==================== 窗口管理状态 ====================

  /** 窗口信息存储: windowId -> WindowInfo */
  private windows: Map<number, WindowInfo> = new Map()

  /** 主窗口 ID */
  private mainWindowId: number | null = null

  /** 当前聚焦的窗口 ID */
  private focusedWindowId: number | null = null

  // ==================== Tab 管理状态 ====================

  /** WebContents ID → Tab ID 映射 (用于快速查找) */
  private webContentsToTabId: Map<number, number> = new Map()

  /** 每个窗口最大 Tab 数量限制 */
  private readonly MAX_TABS_PER_WINDOW = 100

  constructor() {
    // WindowManager 初始化
    // 事件处理由 EventBus 自动扫描注册，参见 src/main/common/eventbus.ts
  }

  // ==================== Tab 管理方法 ====================

  /**
   * 创建新 Tab
   * @param windowId 目标窗口 ID
   * @param config Tab 配置
   * @returns Tab ID，创建失败返回 null
   */
  async createTab(windowId: number, config: TabConfig): Promise<number | null> {
    log.debug(`[WindowManager] 开始创建 Tab: windowId=${windowId}, url=${config.url}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return null
    }

    // 检查 Tab 数量限制
    if (windowInfo.tabs.size >= this.MAX_TABS_PER_WINDOW) {
      log.warn(
        `[WindowManager] 窗口 Tab 数量已达上限: windowId=${windowId}, count=${windowInfo.tabs.size}`
      )
      return null
    }

    try {
      // 1. 创建 WebContentsView（使用窗口的预设配置）
      const preset = this.getWindowPreset(windowInfo.type)
      const view = new WebContentsView({
        webPreferences: preset.webPreferences
      })

      const tabId = view.webContents.id
      log.debug(`[WindowManager] WebContentsView 已创建: tabId=${tabId}`)

      // 2. 计算 position
      const position = windowInfo.tabs.size

      // 3. 创建 TabInfo
      const tabInfo: TabInfo = {
        id: tabId,
        windowId,
        view,
        url: config.url || '',
        title: config.title || '新标签页',
        icon: config.icon,
        isActive: config.active ?? windowInfo.tabs.size === 0, // 如果是第一个 Tab，自动激活
        position,
        closable: config.closable ?? true,
        createdAt: new Date(),
        metadata: config.metadata || {}
      }

      // 4. 创建 TabViewInfo
      const tabViewInfo: TabViewInfo = {
        id: tabId,
        windowId,
        tabId,
        view
      }

      // 5. 注册 Tab
      windowInfo.tabs.set(tabId, tabInfo)
      windowInfo.tabViews.set(tabId, tabViewInfo)
      this.webContentsToTabId.set(view.webContents.id, tabId)

      // 6. 添加到窗口
      windowInfo.window.contentView.addChildView(view)

      // 7. 设置 View 边界
      this.updateViewBounds(windowInfo.window, view)

      // 8. 绑定事件
      this.setupTabEvents(tabViewInfo.view.webContents, tabInfo)

      // 9. 加载内容
      if (config.url) {
        log.debug(`[WindowManager] 开始加载 Tab 内容: tabId=${tabId}, url=${config.url}`)
        await this.loadTabContent(view, config.url)
      }

      // 10. 如果是激活的 Tab，切换到它
      if (tabInfo.isActive) {
        await this.switchTab(windowId, tabId)
      }

      log.info(
        `[WindowManager] Tab 创建成功: tabId=${tabId}, windowId=${windowId}, title=${tabInfo.title}`
      )
      return tabId
    } catch (error) {
      log.error('[WindowManager] 创建 Tab 失败:', error)
      return null
    }
  }

  /**
   * 切换激活的 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功切换
   */
  async switchTab(windowId: number, tabId: number): Promise<boolean> {
    log.debug(`[WindowManager] 切换 Tab: windowId=${windowId}, tabId=${tabId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    const tabInfo = windowInfo.tabs.get(tabId)
    const tabViewInfo = windowInfo.tabViews.get(tabId)
    if (!tabInfo || !tabViewInfo) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return false
    }

    try {
      // 1. 取消当前窗口所有 Tab 的激活状态
      for (const tab of windowInfo.tabs.values()) {
        tab.isActive = false
      }

      // 2. 激活目标 Tab
      tabInfo.isActive = true

      // 3. 将 View 移到最上层（通过重新添加）
      windowInfo.window.contentView.removeChildView(tabViewInfo.view)
      windowInfo.window.contentView.addChildView(tabViewInfo.view)

      // 4. 更新边界
      this.updateViewBounds(windowInfo.window, tabViewInfo.view)

      log.info(
        `[WindowManager] Tab 切换成功: windowId=${windowId}, tabId=${tabId}, title=${tabInfo.title}`
      )
      return true
    } catch (error) {
      log.error('[WindowManager] 切换 Tab 失败:', error)
      return false
    }
  }

  /**
   * 关闭 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功关闭
   */
  async closeTab(windowId: number, tabId: number): Promise<boolean> {
    log.debug(`[WindowManager] 关闭 Tab: windowId=${windowId}, tabId=${tabId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    const tabInfo = windowInfo.tabs.get(tabId)
    const tabViewInfo = windowInfo.tabViews.get(tabId)
    if (!tabInfo || !tabViewInfo) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return false
    }

    // 检查是否可关闭
    if (!tabInfo.closable) {
      log.warn(`[WindowManager] Tab 不可关闭: tabId=${tabId}`)
      return false
    }

    try {
      const wasActive = tabInfo.isActive
      const tabTitle = tabInfo.title

      // 1. 从窗口移除 View
      windowInfo.window.contentView.removeChildView(tabViewInfo.view)

      // 2. 销毁 webContents
      try {
        tabViewInfo.view.webContents.close()
      } catch (e) {
        log.debug('[WindowManager] 关闭 webContents 时出错（可忽略）:', e)
      }

      // 3. 清理 Tab
      this.cleanupTab(tabId)

      // 4. 如果是激活的 Tab，切换到其他 Tab
      if (wasActive && windowInfo.tabs.size > 0) {
        const firstTab = Array.from(windowInfo.tabs.values())[0]
        log.debug(`[WindowManager] 激活的 Tab 被关闭，切换到: tabId=${firstTab.id}`)
        await this.switchTab(windowId, firstTab.id)
      }

      // 5. 重新计算所有 Tab 的 position
      let position = 0
      for (const tab of Array.from(windowInfo.tabs.values()).sort(
        (a, b) => a.position - b.position
      )) {
        tab.position = position++
      }

      log.info(
        `[WindowManager] Tab 关闭成功: tabId=${tabId}, title=${tabTitle}, 剩余=${windowInfo.tabs.size}`
      )
      return true
    } catch (error) {
      log.error('[WindowManager] 关闭 Tab 失败:', error)
      return false
    }
  }

  /**
   * 重新排序 Tab
   * @param windowId 窗口 ID
   * @param tabIds 新的 Tab ID 顺序
   * @returns 是否成功重新排序
   */
  async reorderTabs(windowId: number, tabIds: number[]): Promise<boolean> {
    log.debug(`[WindowManager] 重新排序 Tab: windowId=${windowId}, count=${tabIds.length}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    try {
      // 更新每个 Tab 的 position
      tabIds.forEach((tabId, index) => {
        const tab = windowInfo.tabs.get(tabId)
        if (tab) {
          tab.position = index
        }
      })

      log.info(`[WindowManager] Tab 重新排序成功: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 重新排序 Tab 失败:', error)
      return false
    }
  }

  /**
   * 将 Tab 移动到另一个窗口
   * @param tabId Tab ID
   * @param fromWindowId 源窗口 ID
   * @param toWindowId 目标窗口 ID
   * @returns 是否成功移动
   */
  async moveTabToWindow(tabId: number, fromWindowId: number, toWindowId: number): Promise<boolean> {
    log.debug(`[WindowManager] 移动 Tab: tabId=${tabId}, from=${fromWindowId}, to=${toWindowId}`)

    const fromWindow = this.windows.get(fromWindowId)
    const toWindow = this.windows.get(toWindowId)
    if (!fromWindow || !toWindow) {
      log.warn(`[WindowManager] 源窗口或目标窗口不存在`)
      return false
    }

    const tabInfo = fromWindow.tabs.get(tabId)
    const tabViewInfo = fromWindow.tabViews.get(tabId)
    if (!tabInfo || !tabViewInfo) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return false
    }

    // 检查目标窗口 Tab 数量
    if (toWindow.tabs.size >= this.MAX_TABS_PER_WINDOW) {
      log.warn(
        `[WindowManager] 目标窗口 Tab 数量已达上限: windowId=${toWindowId}, count=${toWindow.tabs.size}`
      )
      return false
    }

    try {
      const tabTitle = tabInfo.title

      // 1. 从源窗口移除
      fromWindow.window.contentView.removeChildView(tabViewInfo.view)
      fromWindow.tabs.delete(tabId)
      fromWindow.tabViews.delete(tabId)

      // 2. 更新 Tab 信息
      tabInfo.windowId = toWindowId
      tabInfo.position = toWindow.tabs.size
      tabInfo.isActive = false
      tabViewInfo.windowId = toWindowId

      // 3. 添加到目标窗口
      toWindow.tabs.set(tabId, tabInfo)
      toWindow.tabViews.set(tabId, tabViewInfo)
      toWindow.window.contentView.addChildView(tabViewInfo.view)

      // 4. 更新边界
      this.updateViewBounds(toWindow.window, tabViewInfo.view)

      log.info(
        `[WindowManager] Tab 移动成功: tabId=${tabId}, title=${tabTitle}, from=${fromWindowId}, to=${toWindowId}`
      )
      return true
    } catch (error) {
      log.error('[WindowManager] 移动 Tab 失败:', error)
      return false
    }
  }

  /**
   * 复制 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 新 Tab 的 ID，失败返回 null
   */
  async duplicateTab(windowId: number, tabId: number): Promise<number | null> {
    log.debug(`[WindowManager] 复制 Tab: windowId=${windowId}, tabId=${tabId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return null
    }

    const tabInfo = windowInfo.tabs.get(tabId)
    if (!tabInfo) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return null
    }

    // 创建新 Tab，复制配置
    const newTabId = await this.createTab(windowId, {
      url: tabInfo.url,
      title: tabInfo.title,
      icon: tabInfo.icon,
      closable: tabInfo.closable,
      active: false,
      metadata: { ...tabInfo.metadata }
    })

    if (newTabId) {
      log.info(`[WindowManager] Tab 复制成功: 原tabId=${tabId}, 新tabId=${newTabId}`)
    }

    return newTabId
  }

  /**
   * 刷新 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功刷新
   */
  reloadTab(windowId: number, tabId: number): boolean {
    log.debug(`[WindowManager] 刷新 Tab: windowId=${windowId}, tabId=${tabId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    const tabViewInfo = windowInfo.tabViews.get(tabId)
    if (!tabViewInfo) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return false
    }

    try {
      tabViewInfo.view.webContents.reload()
      log.info(`[WindowManager] Tab 刷新成功: tabId=${tabId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 刷新 Tab 失败:', error)
      return false
    }
  }

  /**
   * 获取 Tab 信息
   * @param tabId Tab ID
   * @returns Tab 信息
   */
  getTabInfo(tabId: number): TabInfo | undefined {
    // 遍历所有窗口查找 Tab
    for (const windowInfo of this.windows.values()) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab) return tab
    }
    return undefined
  }

  /**
   * 获取窗口的所有 Tab
   * @param windowId 窗口 ID
   * @returns Tab 信息数组（按 position 排序）
   */
  getWindowTabs(windowId: number): TabInfo[] {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return []

    return Array.from(windowInfo.tabs.values()).sort((a, b) => a.position - b.position)
  }

  /**
   * 获取窗口的激活 Tab
   * @param windowId 窗口 ID
   * @returns 激活的 Tab 信息
   */
  getActiveTab(windowId: number): TabInfo | undefined {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return undefined

    return Array.from(windowInfo.tabs.values()).find((tab) => tab.isActive)
  }

  /**
   * 获取窗口的 Tab 数量
   * @param windowId 窗口 ID
   * @returns Tab 数量
   */
  getWindowTabCount(windowId: number): number {
    const windowInfo = this.windows.get(windowId)
    return windowInfo?.tabs.size || 0
  }

  /**
   * 根据 WebContents ID 获取 Tab ID
   * @param webContentsId WebContents ID
   * @returns Tab ID
   */
  getTabIdByWebContentsId(webContentsId: number): number | undefined {
    return this.webContentsToTabId.get(webContentsId)
  }

  // ==================== 默认 Tab 创建 ====================

  /**
   * 创建默认 Tab
   * @param windowId 窗口 ID
   * @param windowType 窗口类型
   * @private
   */
  private async createDefaultTab(windowId: number, windowType: WindowType): Promise<void> {
    try {
      // 根据窗口类型创建默认 Tab
      const defaultTabConfig: TabConfig = {
        url: windowType === 'agent' ? 'local://chat' : 'about:blank',
        title: windowType === 'agent' ? 'Chat' : 'New Tab',
        active: true,
        closable: false // 默认 Tab 不可关闭
      }

      await this.createTab(windowId, defaultTabConfig)
      log.info(`[WindowManager] 默认 Tab 创建成功: windowId=${windowId}, type=${windowType}`)
    } catch (error) {
      log.error('[WindowManager] 创建默认 Tab 失败:', error)
    }
  }

  // ==================== 窗口创建 ====================

  /**
   * 创建新窗口
   * @param config 窗口配置
   * @returns BrowserWindow 实例，创建失败返回 null
   *
   * @example
   * ```typescript
   * // 创建 Agent 窗口（使用预设配置）
   * const agentWindow = windowManager.createWindow({
   *   type: 'agent',
   *   initialUrl: '/shell'
   * })
   *
   * // 创建浏览器窗口并自定义大小
   * const browserWindow = windowManager.createWindow({
   *   type: 'browser',
   *   width: 1440,  // 覆盖预设的 1024
   *   height: 900,  // 覆盖预设的 768
   *   initialUrl: 'https://google.com'
   * })
   * ```
   */
  createWindow(config: WindowConfig): BrowserWindow | null {
    log.debug(`[WindowManager] 开始创建窗口: type=${config.type}`)

    try {
      // 1. 获取预设配置
      const preset = this.getWindowPreset(config.type)

      // 2. 创建窗口状态管理器（为每个窗口类型使用不同的状态文件）
      const windowState = windowStateKeeper({
        defaultWidth: config.width || (preset.width as number) || 1024,
        defaultHeight: config.height || (preset.height as number) || 768,
        file: `${config.type}-window-state.json`, // 每个窗口类型独立的状态文件
        maximize: true, // 记住最大化状态
        fullScreen: true // 记住全屏状态
      })

      // 3. 合并用户配置
      const options: BrowserWindowConstructorOptions = {
        ...preset,
        ...config,
        // 使用保存的窗口状态
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        show: false // 先不显示，等待 ready-to-show
      }

      // 4. 创建 BrowserWindow
      const window = new BrowserWindow(options)
      log.debug(`[WindowManager] BrowserWindow 已创建: windowId=${window.id}`)

      // 5. 让窗口状态管理器管理窗口（自动保存位置、大小等）
      windowState.manage(window)

      // 6. 创建窗口信息
      const windowInfo: WindowInfo = {
        id: window.id,
        type: config.type,
        window,
        isMain: config.type === 'agent' && !this.mainWindowId,
        createdAt: new Date(),
        metadata: config.metadata || {},
        state: {
          isVisible: false,
          isFocused: false,
          isMinimized: false,
          isMaximized: false,
          isFullScreen: false
        },
        tabs: new Map(),
        tabViews: new Map()
      }

      // 7. 注册窗口
      this.windows.set(window.id, windowInfo)

      // 8. 设置主窗口
      if (windowInfo.isMain) {
        this.mainWindowId = window.id
        log.info(`[WindowManager] 设置主窗口: windowId=${window.id}`)
      }

      // 9. 加载窗口内容
      this.loadWindowContent(window, config.type)

      // 10. 设置 DevTools（开发环境）
      this.setupDevTools(window)

      // 11. 绑定窗口事件
      this.setupWindowEvents(window.id)

      // 12. 创建默认 Tab
      this.createDefaultTab(window.id, config.type)

      log.info(
        `[WindowManager] 窗口创建成功: windowId=${window.id}, type=${config.type}, isMain=${windowInfo.isMain}`
      )
      return window
    } catch (error) {
      log.error('[WindowManager] 创建窗口失败:', error)
      return null
    }
  }

  // ==================== 窗口查询 ====================

  /**
   * 根据 ID 获取窗口
   * @param windowId 窗口 ID
   * @returns BrowserWindow 实例
   */
  getWindow(windowId: number): BrowserWindow | undefined {
    return this.windows.get(windowId)?.window
  }

  /**
   * 获取主窗口
   * @returns 主窗口实例
   */
  getMainWindow(): BrowserWindow | undefined {
    return this.mainWindowId ? this.windows.get(this.mainWindowId)?.window : undefined
  }

  /**
   * 获取当前聚焦的窗口
   * @returns 聚焦窗口实例
   */
  getFocusedWindow(): BrowserWindow | undefined {
    return this.focusedWindowId ? this.windows.get(this.focusedWindowId)?.window : undefined
  }

  /**
   * 获取所有窗口
   * @returns 所有窗口实例数组
   */
  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).map((info) => info.window)
  }

  /**
   * 根据类型获取窗口
   * @param type 窗口类型
   * @returns 该类型的所有窗口
   */
  getWindowsByType(type: WindowType): BrowserWindow[] {
    return Array.from(this.windows.values())
      .filter((info) => info.type === type)
      .map((info) => info.window)
  }

  /**
   * 获取窗口信息
   * @param windowId 窗口 ID
   * @returns 窗口信息
   */
  getWindowInfo(windowId: number): WindowInfo | undefined {
    return this.windows.get(windowId)
  }

  /**
   * 获取窗口数量
   * @returns 窗口数量
   */
  getWindowCount(): number {
    return this.windows.size
  }

  // ==================== 窗口操作 ====================

  /**
   * 关闭窗口
   * @param windowId 窗口 ID
   * @returns 是否成功关闭
   */
  async closeWindow(windowId: number): Promise<boolean> {
    log.debug(`[WindowManager] 关闭窗口: windowId=${windowId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    try {
      const tabCount = windowInfo.tabs.size
      windowInfo.window.close()
      log.info(`[WindowManager] 窗口关闭成功: windowId=${windowId}, 关闭了 ${tabCount} 个 Tab`)
      return true
    } catch (error) {
      log.error('[WindowManager] 关闭窗口失败:', error)
      return false
    }
  }

  /**
   * 聚焦窗口
   * @param windowId 窗口 ID
   * @returns 是否成功聚焦
   */
  focusWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.focus()
      log.debug(`[WindowManager] 窗口聚焦: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 聚焦窗口失败:', error)
      return false
    }
  }

  /**
   * 最小化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最小化
   */
  minimizeWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.minimize()
      log.debug(`[WindowManager] 窗口最小化: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 最小化窗口失败:', error)
      return false
    }
  }

  /**
   * 最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最大化
   */
  maximizeWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.maximize()
      log.debug(`[WindowManager] 窗口最大化: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 最大化窗口失败:', error)
      return false
    }
  }

  /**
   * 取消最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功取消最大化
   */
  unmaximizeWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.unmaximize()
      log.debug(`[WindowManager] 取消最大化: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 取消最大化窗口失败:', error)
      return false
    }
  }

  /**
   * 全屏窗口
   * @param windowId 窗口 ID
   * @param fullscreen 是否全屏
   * @returns 是否成功设置全屏
   */
  setFullScreen(windowId: number, fullscreen: boolean): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.setFullScreen(fullscreen)
      log.debug(`[WindowManager] 设置全屏: windowId=${windowId}, fullscreen=${fullscreen}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 设置全屏失败:', error)
      return false
    }
  }

  /**
   * 显示窗口
   * @param windowId 窗口 ID
   * @returns 是否成功显示
   */
  showWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.show()
      windowInfo.state.isVisible = true
      log.debug(`[WindowManager] 显示窗口: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 显示窗口失败:', error)
      return false
    }
  }

  /**
   * 隐藏窗口
   * @param windowId 窗口 ID
   * @returns 是否成功隐藏
   */
  hideWindow(windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.hide()
      windowInfo.state.isVisible = false
      log.debug(`[WindowManager] 隐藏窗口: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 隐藏窗口失败:', error)
      return false
    }
  }

  // ==================== 窗口状态 ====================

  /**
   * 获取窗口状态
   * @param windowId 窗口 ID
   * @returns 窗口状态
   */
  getWindowState(windowId: number): WindowState | null {
    const windowInfo = this.windows.get(windowId)
    return windowInfo?.state || null
  }

  /**
   * 获取窗口边界
   * @param windowId 窗口 ID
   * @returns 窗口边界
   */
  getWindowBounds(windowId: number): WindowBounds | null {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return null

    try {
      return windowInfo.window.getBounds()
    } catch (error) {
      log.error('[WindowManager] 获取窗口边界失败:', error)
      return null
    }
  }

  /**
   * 设置窗口边界
   * @param windowId 窗口 ID
   * @param bounds 窗口边界
   * @returns 是否成功设置
   */
  setWindowBounds(windowId: number, bounds: Partial<WindowBounds>): boolean {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return false

    try {
      windowInfo.window.setBounds(bounds)
      log.debug(`[WindowManager] 设置窗口边界: windowId=${windowId}`)
      return true
    } catch (error) {
      log.error('[WindowManager] 设置窗口边界失败:', error)
      return false
    }
  }

  // ==================== 窗口通信 ====================

  /**
   * 向指定窗口发送消息
   * @param windowId 窗口 ID
   * @param channel 通道名称
   * @param args 参数
   */
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return

    try {
      windowInfo.window.webContents.send(channel, ...args)
      log.debug(`[WindowManager] 发送消息: windowId=${windowId}, channel=${channel}`)
    } catch (error) {
      log.error('[WindowManager] 发送消息失败:', error)
    }
  }

  /**
   * 向所有窗口广播消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToAllWindows(channel: string, ...args: unknown[]): void {
    const count = this.windows.size
    log.debug(`[WindowManager] 广播消息: channel=${channel}, windowCount=${count}`)

    for (const windowInfo of this.windows.values()) {
      try {
        windowInfo.window.webContents.send(channel, ...args)
      } catch (error) {
        log.error('[WindowManager] 广播消息失败:', error)
      }
    }
  }

  /**
   * 向聚焦窗口发送消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToFocused(channel: string, ...args: unknown[]): void {
    if (!this.focusedWindowId) return
    this.sendToWindow(this.focusedWindowId, channel, ...args)
  }

  // ==================== 内部方法 ====================

  /**
   * 获取窗口预设配置
   * @param type 窗口类型
   * @returns 预设配置
   */
  private getWindowPreset(type: WindowType): Partial<BrowserWindowConstructorOptions> {
    const presets = getWindowPresets(Env.isDev)
    return presets[type]
  }

  /**
   * 设置窗口事件监听器
   * @param windowId 窗口 ID
   */
  private setupWindowEvents(windowId: number): void {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return

    const { window } = windowInfo
    log.debug(`[WindowManager] 绑定窗口事件: windowId=${windowId}`)

    // ready-to-show: 窗口准备显示
    window.once(BrowserWindowEvents.READY_TO_SHOW, () => {
      windowInfo.state.isVisible = true
      window.show()
      log.info(`[WindowManager] 窗口已显示: windowId=${windowId}`)
    })

    // closed: 窗口关闭
    window.on(BrowserWindowEvents.CLOSED, () => {
      log.info(`[WindowManager] 窗口已关闭: windowId=${windowId}`)
      this.cleanupWindow(windowId)
    })

    // focus: 获得焦点
    window.on(BrowserWindowEvents.FOCUS, () => {
      windowInfo.state.isFocused = true
      this.focusedWindowId = windowId
    })

    // blur: 失去焦点
    window.on(BrowserWindowEvents.BLUR, () => {
      windowInfo.state.isFocused = false
      if (this.focusedWindowId === windowId) {
        this.focusedWindowId = null
      }
    })

    // minimize: 最小化
    window.on(BrowserWindowEvents.MINIMIZE, () => {
      windowInfo.state.isMinimized = true
    })

    // maximize: 最大化
    window.on(BrowserWindowEvents.MAXIMIZE, () => {
      windowInfo.state.isMaximized = true
    })

    // unmaximize: 取消最大化
    window.on(BrowserWindowEvents.UNMAXIMIZE, () => {
      windowInfo.state.isMaximized = false
    })

    // restore: 恢复
    window.on(BrowserWindowEvents.RESTORE, () => {
      windowInfo.state.isMinimized = false
    })

    // enter-full-screen: 进入全屏
    window.on(BrowserWindowEvents.ENTER_FULL_SCREEN, () => {
      windowInfo.state.isFullScreen = true
    })

    // leave-full-screen: 离开全屏
    window.on(BrowserWindowEvents.LEAVE_FULL_SCREEN, () => {
      windowInfo.state.isFullScreen = false
    })

    // resize: 窗口大小变化时更新所有 Tab 的边界
    window.on(BrowserWindowEvents.RESIZE, () => {
      for (const tabView of windowInfo.tabViews.values()) {
        this.updateViewBounds(window, tabView.view)
      }
    })
  }

  /**
   * 加载窗口内容
   * @param window BrowserWindow 实例
   * @param type 窗口类型
   */
  private loadWindowContent(window: BrowserWindow, type: WindowType): void {
    try {
      if (Env.isDev) {
        // 开发环境：使用 Vite 开发服务器
        const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
        if (!devServerUrl) {
          throw new Error('ELECTRON_RENDERER_URL 或 VITE_DEV_SERVER_URL 未定义')
        }

        // 根据窗口类型加载不同的 HTML
        let htmlPath = ''
        switch (type) {
          case 'agent':
            htmlPath = '/shell.html'
            break
          case 'browser':
            htmlPath = '/browser.html'
            break
          default:
            htmlPath = '/index.html'
        }

        const fullUrl = `${devServerUrl}${htmlPath}`
        window.loadURL(fullUrl)
        log.info(`[WindowManager] 加载开发服务器页面: ${fullUrl}`)
      } else {
        // 生产环境：加载打包后的文件
        let htmlFile = ''
        switch (type) {
          case 'agent':
            htmlFile = 'shell.html'
            break
          case 'browser':
            htmlFile = 'browser.html'
            break
          default:
            htmlFile = 'index.html'
        }

        const htmlPath = join(__dirname, '../renderer', htmlFile)
        window.loadFile(htmlPath)
        log.info(`[WindowManager] 加载本地文件: ${htmlPath}`)
      }
    } catch (error) {
      log.error(`[WindowManager] 加载窗口内容失败: windowId=${window.id}, type=${type}`, error)
      throw error
    }
  }

  /**
   * 设置 DevTools（开发环境）
   * @param window BrowserWindow 实例
   */
  private setupDevTools(window: BrowserWindow): void {
    if (!Env.isDev) {
      return
    }

    const openDevTools = Env.main.openDevTools
    if (!openDevTools) {
      return
    }

    try {
      type DevToolsMode = 'right' | 'bottom' | 'undocked' | 'detach'

      if (openDevTools === 'true') {
        // 默认在右侧打开
        window.webContents.openDevTools({ mode: 'right' })
        log.info(`[WindowManager] DevTools 已打开: windowId=${window.id}, mode=right`)
      } else if (['bottom', 'right', 'undocked', 'detach'].includes(openDevTools)) {
        // 使用指定的模式
        window.webContents.openDevTools({ mode: openDevTools as DevToolsMode })
        log.info(`[WindowManager] DevTools 已打开: windowId=${window.id}, mode=${openDevTools}`)
      }
    } catch (error) {
      log.warn(`[WindowManager] 打开 DevTools 失败: windowId=${window.id}`, error)
    }
  }

  /**
   * 清理窗口资源
   * @param windowId 窗口 ID
   */
  private cleanupWindow(windowId: number): void {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return

    const tabCount = windowInfo.tabs.size
    log.debug(`[WindowManager] 清理窗口资源: windowId=${windowId}, tabCount=${tabCount}`)

    // 1. 清理所有 Tab
    for (const tabId of windowInfo.tabs.keys()) {
      this.cleanupTab(tabId)
    }

    // 2. 从 Map 中移除窗口
    this.windows.delete(windowId)

    // 3. 更新主窗口 ID
    if (this.mainWindowId === windowId) {
      this.mainWindowId = null
      log.info('[WindowManager] 主窗口已清理')
    }

    // 4. 更新聚焦窗口 ID
    if (this.focusedWindowId === windowId) {
      this.focusedWindowId = null
    }

    log.info(`[WindowManager] 窗口资源清理完成: windowId=${windowId}`)
  }

  // ==================== Tab 内部方法 ====================

  /**
   * 更新 View 边界（考虑 Chrome 高度）
   * @param window BrowserWindow 实例
   * @param view WebContentsView 实例
   */
  private updateViewBounds(window: BrowserWindow, view: WebContentsView): void {
    try {
      const bounds = window.getContentBounds()
      view.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width: bounds.width,
        height: bounds.height - CHROME_HEIGHT
      })
      log.debug(
        `[WindowManager] 更新 View 边界: width=${bounds.width}, height=${bounds.height - CHROME_HEIGHT}`
      )
    } catch (error) {
      log.error('[WindowManager] 更新 View 边界失败:', error)
    }
  }

  /**
   * 加载 Tab 内容
   * @param view WebContentsView 实例
   * @param url URL（支持 local:// 协议和外部 URL）
   */
  private async loadTabContent(view: WebContentsView, url: string): Promise<void> {
    try {
      let finalUrl = url

      // 处理相对路径，自动添加 local:// 前缀
      if (url.startsWith('/')) {
        url = `local://${url.substring(1) || 'chat'}`
        log.debug(`[WindowManager] 相对路径转换为 local:// 协议: ${url}`)
      }

      // 处理 local:// 协议（应用内路由）
      if (url.startsWith('local://')) {
        const route = url.replace('local://', '')

        if (Env.isDev) {
          // 开发环境：使用 Vite 开发服务器
          const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
          if (!devServerUrl) {
            throw new Error('ELECTRON_RENDERER_URL 或 VITE_DEV_SERVER_URL 未定义')
          }
          finalUrl = `${devServerUrl}#/${route}`
          log.debug(`[WindowManager] 开发环境加载本地路由: ${finalUrl}`)
        } else {
          // 生产环境：加载打包后的文件
          const htmlPath = join(__dirname, '../renderer/index.html')
          finalUrl = `file://${htmlPath}#/${route}`
          log.debug(`[WindowManager] 生产环境加载本地路由: ${finalUrl}`)
        }
      }

      await view.webContents.loadURL(finalUrl)
      log.info(`[WindowManager] Tab 内容加载完成: ${url} -> ${finalUrl}`)
    } catch (error) {
      log.error(`[WindowManager] 加载 Tab 内容失败: url=${url}`, error)
      throw error
    }
  }

  /**
   * 设置 Tab 事件
   * @param webContents WebContents 实例
   * @param tabInfo Tab 信息（用于更新状态）
   */
  private setupTabEvents(webContents: Electron.WebContents, tabInfo: TabInfo): void {
    const tabId = tabInfo.id
    log.debug(`[WindowManager] 绑定 Tab 事件: tabId=${tabId}`)

    // page-title-updated: 页面标题更新
    webContents.on('page-title-updated', (_event, title) => {
      tabInfo.title = title
      log.debug(`[WindowManager] Tab 标题更新: tabId=${tabId}, title=${title}`)
    })

    // did-navigate: 页面导航
    webContents.on('did-navigate', (_event, url) => {
      tabInfo.url = url
      log.debug(`[WindowManager] Tab 导航: tabId=${tabId}, url=${url}`)
    })

    // page-favicon-updated: 图标更新
    webContents.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        tabInfo.icon = favicons[0]
        log.debug(`[WindowManager] Tab 图标更新: tabId=${tabId}`)
      }
    })

    // destroyed: webContents 销毁时自动清理
    webContents.once('destroyed', () => {
      log.debug(`[WindowManager] WebContents 已销毁: tabId=${tabId}`)
      // 事件监听器会自动清理
    })
  }

  /**
   * 通知窗口 Tab 列表更新
   * @param windowId 窗口 ID
   */
  // @ts-expect-error - 保留供未来使用
  private _notifyWindowTabsUpdate(windowId: number): void {
    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) return

    try {
      const tabs = this.getWindowTabs(windowId)
      this.sendToWindow(windowId, 'tabs:updated', tabs)
      log.debug(`[WindowManager] 通知窗口 Tab 更新: windowId=${windowId}, count=${tabs.length}`)
    } catch (error) {
      log.error('[WindowManager] 通知窗口 Tab 列表更新失败:', error)
    }
  }

  /**
   * 清理 Tab 资源
   * @param tabId Tab ID
   */
  private cleanupTab(tabId: number): void {
    log.debug(`[WindowManager] 清理 Tab 资源: tabId=${tabId}`)

    // 遍历所有窗口查找并清理 Tab
    for (const windowInfo of this.windows.values()) {
      if (windowInfo.tabs.has(tabId)) {
        windowInfo.tabs.delete(tabId)
        windowInfo.tabViews.delete(tabId)
      }
    }

    // 清理 webContents 映射
    this.webContentsToTabId.delete(tabId)
  }

  /**
   * 验证 Tab 是否属于窗口
   * @param tabId Tab ID
   * @param windowId 窗口 ID
   * @returns 是否属于该窗口
   */
  // @ts-ignore - 保留供未来使用
  private _isTabInWindow(tabId: number, windowId: number): boolean {
    const windowInfo = this.windows.get(windowId)
    return windowInfo?.tabs.has(tabId) ?? false
  }
}
