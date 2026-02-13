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
import { getWindowPresets, CHROME_HEIGHT, BrowserWindowEvents, WebContentsEvents } from './types'
import { log } from '@main/common/logger'
import { eventBus } from '@main/common/eventbus'
import { EventTypes } from '@shared/ipc/events'
import { Env } from '@main/common/env'
import { IconManager } from '@main/common/icons'

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

      // 8. 设置 DevTools（开发环境）- 在内容窗口上
      this.setupDevTools(view)

      // 9. 绑定事件
      this.setupTabEvents(tabViewInfo.view.webContents, tabInfo)

      // 10. 加载内容
      if (config.url) {
        log.debug(`[WindowManager] 开始加载 Tab 内容: tabId=${tabId}, url=${config.url}`)
        await this.loadTabContent(view, config.url)
      }

      // 11. 如果是激活的 Tab，切换到它
      if (tabInfo.isActive) {
        await this.switchTab(windowId, tabId)
      }

      log.info(
        `[WindowManager] Tab 创建成功: tabId=${tabId}, windowId=${windowId}, title=${tabInfo.title}`
      )

      // 发送 tab:created 事件
      eventBus.emit(EventTypes.TAB_CREATED, {
        windowId,
        tabId,
        title: tabInfo.title,
        url: tabInfo.url,
        position: tabInfo.position
      })

      // 打印状态快照
      this.printWindowsState(`Tab 创建 - tabId=${tabId}`)

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
      // 记录之前激活的 Tab ID
      const previousTab = Array.from(windowInfo.tabs.values()).find((t) => t.isActive)
      const previousTabId = previousTab ? previousTab.id : null

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

      // 发送 tab:activated 事件
      eventBus.emit(EventTypes.TAB_ACTIVATED, {
        windowId,
        tabId,
        previousTabId
      })

      // 打印状态快照
      this.printWindowsState(`Tab 切换 - tabId=${tabId}`)

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

      // 4. 发送 tab:closed 事件
      eventBus.emit(EventTypes.TAB_CLOSED, {
        windowId,
        tabId
      })

      // 5. 检查剩余 Tab 数量
      const remainingTabsCount = windowInfo.tabs.size

      if (remainingTabsCount === 0) {
        // 关闭最后一个 Tab 时，关闭整个窗口
        log.info(
          `[WindowManager] 最后一个 Tab 已关闭 (tabId=${tabId}, title=${tabTitle})，关闭窗口 windowId=${windowId}`
        )
        await this.closeWindow(windowId)
      } else {
        // 还有其他 Tab
        log.info(
          `[WindowManager] Tab 关闭成功: tabId=${tabId}, title=${tabTitle}, 剩余=${remainingTabsCount}`
        )

        // 如果关闭的是激活的 Tab，切换到第一个 Tab
        if (wasActive) {
          const firstTab = Array.from(windowInfo.tabs.values())[0]
          log.debug(`[WindowManager] 激活的 Tab 被关闭，切换到: tabId=${firstTab.id}`)
          await this.switchTab(windowId, firstTab.id)
        }

        // 重新计算所有 Tab 的 position
        let position = 0
        for (const tab of Array.from(windowInfo.tabs.values()).sort(
          (a, b) => a.position - b.position
        )) {
          tab.position = position++
        }

        // 打印状态快照
        this.printWindowsState(`Tab 关闭 - tabId=${tabId}`)
      }

      return true
    } catch (error) {
      log.error('[WindowManager] 关闭 Tab 失败:', error)
      return false
    }
  }

  /**
   * 更新 Tab 信息
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @param updates 要更新的字段
   * @returns 是否成功更新
   */
  updateTab(windowId: number, tabId: number, updates: { title?: string; url?: string }): boolean {
    log.debug(`[WindowManager] 更新 Tab: windowId=${windowId}, tabId=${tabId}`)

    const windowInfo = this.windows.get(windowId)
    if (!windowInfo) {
      log.warn(`[WindowManager] 窗口不存在: windowId=${windowId}`)
      return false
    }

    const tab = windowInfo.tabs.get(tabId)
    if (!tab) {
      log.warn(`[WindowManager] Tab 不存在: tabId=${tabId}`)
      return false
    }

    try {
      // 更新 Tab 信息
      if (updates.title !== undefined) {
        tab.title = updates.title
      }
      if (updates.url !== undefined) {
        tab.url = updates.url
      }

      log.info(`[WindowManager] Tab 更新成功: tabId=${tabId}`)

      // 发送 tab:updated 事件
      eventBus.emit(EventTypes.TAB_UPDATED, {
        windowId,
        tabId,
        title: updates.title,
        url: updates.url
      })

      return true
    } catch (error) {
      log.error('[WindowManager] 更新 Tab 失败:', error)
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
      // 记录所有位置变化
      const changes: Array<{ tabId: number; fromPosition: number; toPosition: number }> = []

      // 更新每个 Tab 的 position
      tabIds.forEach((tabId, toPosition) => {
        const tab = windowInfo.tabs.get(tabId)
        if (tab) {
          const fromPosition = tab.position
          if (fromPosition !== toPosition) {
            changes.push({ tabId, fromPosition, toPosition })
          }
          tab.position = toPosition
        }
      })

      log.info(`[WindowManager] Tab 重新排序成功: windowId=${windowId}, 变化数=${changes.length}`)

      // 发送统一的 tabs:reordered 事件
      if (changes.length > 0) {
        eventBus.emit(EventTypes.TABS_REORDERED, {
          windowId,
          tabIds,
          changes
        })

        // 打印状态快照
        this.printWindowsState(`Tab 重新排序 - windowId=${windowId}`)
      }

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

      // 发送 tab:moved-to-window 事件
      eventBus.emit(EventTypes.TAB_MOVED_TO_WINDOW, {
        tabId,
        fromWindowId,
        toWindowId,
        title: tabTitle
      })

      // 打印状态快照
      this.printWindowsState(`Tab 移动 - tabId=${tabId}, from=${fromWindowId}, to=${toWindowId}`)

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

      // 发送 tab:duplicated 事件
      eventBus.emit(EventTypes.TAB_DUPLICATED, {
        windowId,
        originalTabId: tabId,
        newTabId,
        title: tabInfo.title
      })

      // 打印状态快照
      this.printWindowsState(`Tab 复制 - 原tabId=${tabId}, 新tabId=${newTabId}`)
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

      // 发送 tab:reloaded 事件
      eventBus.emit(EventTypes.TAB_RELOADED, {
        windowId,
        tabId
      })

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
        closable: true // 都可以关闭
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
        // 设置应用图标
        icon: IconManager.getAppIcon(),
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

      // 10. 绑定窗口事件
      this.setupWindowEvents(window.id)

      // 11. 创建默认 Tab
      this.createDefaultTab(window.id, config.type)

      log.info(
        `[WindowManager] 窗口创建成功: windowId=${window.id}, type=${config.type}, isMain=${windowInfo.isMain}`
      )

      // 发送 window:created 事件到 eventBus
      eventBus.emit(EventTypes.WINDOW_CREATED, {
        windowId: window.id,
        type: config.type
      })

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

  /**
   * 打印当前所有窗口和 Tab 的状态（调试用）
   */
  private printWindowsState(action: string): void {
    log.info(`\n${'='.repeat(80)}`)
    log.info(`[WindowManager] 状态快照 - ${action}`)
    log.info(`${'='.repeat(80)}`)
    log.info(`窗口总数: ${this.windows.size}`)

    this.windows.forEach((windowInfo, windowId) => {
      const tabs = this.getWindowTabs(windowId)
      const activeTab = this.getActiveTab(windowId)

      log.info(`\n窗口 #${windowId} (${windowInfo.type})`)
      log.info(`  - 是否主窗口: ${windowInfo.isMain}`)
      log.info(`  - Tab 总数: ${tabs.length}`)
      log.info(`  - 当前激活 Tab: ${activeTab ? `#${activeTab.id} "${activeTab.title}"` : '无'}`)

      if (tabs.length > 0) {
        log.info(`  - Tab 列表:`)
        tabs.forEach((tab) => {
          const status: string[] = []
          if (tab.isActive) status.push('激活')
          if (tab.closable) status.push('可关闭')
          else status.push('不可关闭')

          log.info(
            `    [${tab.position}] Tab #${tab.id}: "${tab.title}" ${status.length > 0 ? `(${status.join(', ')})` : ''}`
          )
          log.info(`         URL: ${tab.url}`)
        })
      }
    })

    log.info(`${'='.repeat(80)}\n`)
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
      const window = windowInfo.window

      // ✅ 先隐藏窗口，避免关闭过程中出现白屏
      if (!window.isDestroyed() && window.isVisible()) {
        window.hide()
        log.debug(`[WindowManager] 窗口已隐藏，准备关闭: windowId=${windowId}`)
      }

      // 调用 close() 触发关闭流程
      // → CLOSE 事件 → CLOSED 事件 → cleanupWindow()
      window.close()
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
    window.once(BrowserWindowEvents.READY_TO_SHOW, async () => {
      windowInfo.state.isVisible = true
      window.show()

      // macOS: 显示 Dock 图标（当有窗口显示时）
      if (process.platform === 'darwin') {
        const { app } = await import('electron')
        app.dock?.show()
      }

      log.info(`[WindowManager] 窗口已显示: windowId=${windowId}`)

      // 发送 window:ready 事件
      eventBus.emit(EventTypes.WINDOW_READY, {
        windowId
      })
    })

    // show: 窗口显示
    window.on(BrowserWindowEvents.SHOW, async () => {
      log.debug(`[WindowManager] 窗口显示: windowId=${windowId}`)

      // macOS: 显示 Dock 图标（当有窗口显示时）
      if (process.platform === 'darwin') {
        const { app } = await import('electron')
        app.dock?.show()
      }

      eventBus.emit(EventTypes.WINDOW_SHOW, {
        windowId
      })
    })

    // hide: 窗口隐藏
    window.on(BrowserWindowEvents.HIDE, () => {
      log.debug(`[WindowManager] 窗口隐藏: windowId=${windowId}`)

      eventBus.emit(EventTypes.WINDOW_HIDE, {
        windowId
      })
    })

    // close: 窗口即将关闭（可阻止）
    window.on(BrowserWindowEvents.CLOSE, async (e) => {
      log.debug(`[WindowManager] 窗口即将关闭: windowId=${windowId}`)

      // 如果应用正在退出，不要阻止窗口关闭
      const { stateManager } = await import('@main/common/state')
      if (stateManager.getIsQuitting()) {
        log.debug(`[WindowManager] 应用正在退出，允许窗口关闭: windowId=${windowId}`)
        return
      }

      // 检查托盘配置
      const { config } = await import('@main/common/config')
      const showTrayIcon = config.getShowTrayIcon()
      const closeToTray = config.getCloseToTray()

      // 托盘模式：阻止关闭，隐藏窗口
      if (showTrayIcon && closeToTray) {
        e.preventDefault()
        window.hide()

        // macOS: 隐藏 Dock 图标
        if (process.platform === 'darwin') {
          const { app } = await import('electron')
          app.dock?.hide()
        }

        log.info(
          `[WindowManager] 托盘模式：窗口已隐藏 windowId=${windowId}${process.platform === 'darwin' ? ', Dock 已隐藏' : ''}`
        )
        // 不需要继续处理
        return
      }

      // 非托盘模式或应用退出：什么都不做，让窗口正常关闭
      //    → 触发 'closed' 事件 → cleanupWindow()
      //    → 如果是最后一个窗口 → 'window-all-closed' → 决定是否退出

      // 发送 window:close 事件
      eventBus.emit(EventTypes.WINDOW_CLOSE, {
        windowId
      })
    })

    // closed: 窗口已关闭
    window.on(BrowserWindowEvents.CLOSED, () => {
      log.info(`[WindowManager] 窗口已关闭: windowId=${windowId}`)

      // 发送 window:closed 事件到 eventBus
      eventBus.emit(EventTypes.WINDOW_CLOSED, {
        windowId
      })

      this.cleanupWindow(windowId)
    })

    // focus: 获得焦点
    window.on(BrowserWindowEvents.FOCUS, () => {
      windowInfo.state.isFocused = true
      this.focusedWindowId = windowId

      // 发送 window:focused 事件到 eventBus
      eventBus.emit(EventTypes.WINDOW_FOCUSED, {
        windowId
      })
    })

    // blur: 失去焦点
    window.on(BrowserWindowEvents.BLUR, () => {
      windowInfo.state.isFocused = false
      if (this.focusedWindowId === windowId) {
        this.focusedWindowId = null
      }

      // 发送 window:blurred 事件到 eventBus
      eventBus.emit(EventTypes.WINDOW_BLURRED, {
        windowId
      })
    })

    // minimize: 最小化
    window.on(BrowserWindowEvents.MINIMIZE, () => {
      windowInfo.state.isMinimized = true

      eventBus.emit(EventTypes.WINDOW_MINIMIZED, {
        windowId
      })
    })

    // maximize: 最大化
    window.on(BrowserWindowEvents.MAXIMIZE, () => {
      windowInfo.state.isMaximized = true

      eventBus.emit(EventTypes.WINDOW_MAXIMIZED, {
        windowId
      })
    })

    // unmaximize: 取消最大化
    window.on(BrowserWindowEvents.UNMAXIMIZE, () => {
      windowInfo.state.isMaximized = false

      eventBus.emit(EventTypes.WINDOW_UNMAXIMIZED, {
        windowId
      })
    })

    // restore: 恢复
    window.on(BrowserWindowEvents.RESTORE, () => {
      windowInfo.state.isMinimized = false

      eventBus.emit(EventTypes.WINDOW_RESTORED, {
        windowId
      })
    })

    // enter-full-screen: 进入全屏
    window.on(BrowserWindowEvents.ENTER_FULL_SCREEN, () => {
      windowInfo.state.isFullScreen = true

      eventBus.emit(EventTypes.WINDOW_ENTER_FULL_SCREEN, {
        windowId
      })
    })

    // leave-full-screen: 离开全屏
    window.on(BrowserWindowEvents.LEAVE_FULL_SCREEN, () => {
      windowInfo.state.isFullScreen = false

      eventBus.emit(EventTypes.WINDOW_LEAVE_FULL_SCREEN, {
        windowId
      })
    })

    // resize: 窗口大小变化时更新所有 Tab 的边界
    window.on(BrowserWindowEvents.RESIZE, () => {
      for (const tabView of windowInfo.tabViews.values()) {
        this.updateViewBounds(window, tabView.view)
      }

      const bounds = window.getBounds()
      eventBus.emit(EventTypes.WINDOW_RESIZED, {
        windowId,
        bounds
      })
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
          case 'console':
            htmlPath = '/console.html'
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
          case 'console':
            htmlFile = 'console.html'
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
   * 创建控制台窗口（独立方法，不参与通用窗口管理）
   */
  createConsoleWindow(): BrowserWindow | null {
    try {
      log.info('[WindowManager] 开始创建控制台窗口...')

      // 简单的控制台窗口配置
      const consoleWindow = new BrowserWindow({
        width: 400,
        height: 700,
        minWidth: 350,
        minHeight: 500,
        frame: false,
        transparent: false,
        resizable: false,
        backgroundColor: '#f9fafb',
        title: 'Coobee AI 控制台',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      // 加载控制台页面
      if (Env.isDev) {
        const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
        if (devServerUrl) {
          consoleWindow.loadURL(`${devServerUrl}/console.html`)
        }
      } else {
        const htmlPath = join(__dirname, '../renderer/console.html')
        consoleWindow.loadFile(htmlPath)
      }

      log.info('[WindowManager] 控制台窗口创建成功')
      return consoleWindow
    } catch (error) {
      log.error('[WindowManager] 创建控制台窗口失败:', error)
      return null
    }
  }

  /**
   * 设置 DevTools（开发环境）
   * @param window BrowserWindow 实例
   */
  private setupDevTools(view: WebContentsView): void {
    const tabId = view.webContents.id
    log.debug(`[WindowManager] setupDevTools 开始: tabId=${tabId}, isDev=${Env.isDev}`)

    if (!Env.isDev) {
      log.debug(`[WindowManager] 非开发环境，跳过 DevTools 设置`)
      return
    }

    const openDevTools = Env.main.openDevTools
    log.debug(`[WindowManager] openDevTools 值: "${openDevTools}", 类型: ${typeof openDevTools}`)

    if (!openDevTools) {
      log.debug(`[WindowManager] openDevTools 为空，跳过`)
      return
    }

    try {
      type DevToolsMode = 'right' | 'bottom' | 'undocked' | 'detach'

      if (openDevTools === 'true') {
        // 默认在右侧打开
        view.webContents.openDevTools({ mode: 'right' })
        log.info(`[WindowManager] DevTools 已打开: tabId=${tabId}, mode=right`)
      } else if (['bottom', 'right', 'undocked', 'detach'].includes(openDevTools)) {
        // 使用指定的模式
        view.webContents.openDevTools({ mode: openDevTools as DevToolsMode })
        log.info(`[WindowManager] DevTools 已打开: tabId=${tabId}, mode=${openDevTools}`)
      } else {
        log.warn(`[WindowManager] 无效的 openDevTools 值: "${openDevTools}"`)
      }
    } catch (error) {
      log.warn(`[WindowManager] 打开 DevTools 失败: tabId=${tabId}`, error)
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

    // 2. ✅ 关键修复：移除窗口的所有事件监听器，打破循环引用
    if (!windowInfo.window.isDestroyed()) {
      windowInfo.window.removeAllListeners()
      log.debug(`[WindowManager] 已移除窗口的所有事件监听器: windowId=${windowId}`)
    }

    // 3. 从 Map 中移除窗口
    this.windows.delete(windowId)

    // 4. 更新主窗口 ID
    if (this.mainWindowId === windowId) {
      this.mainWindowId = null
      log.info('[WindowManager] 主窗口已清理')
    }

    // 5. 更新聚焦窗口 ID
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

    // console-message: 转发渲染进程日志到主进程（便于调试）
    if (Env.isDev) {
      webContents.on(
        WebContentsEvents.CONSOLE_MESSAGE,
        (_event, level, message, _line, _source) => {
          const prefix = `[Renderer:${tabId}]`
          if (level === 0) log.debug(`${prefix} ${message}`)
          else if (level === 1) log.info(`${prefix} ${message}`)
          else if (level === 2) log.warn(`${prefix} ${message}`)
          else log.error(`${prefix} ${message}`)
        }
      )
    }

    // page-title-updated: 页面标题更新
    webContents.on(WebContentsEvents.PAGE_TITLE_UPDATED, (_event, title) => {
      const oldTitle = tabInfo.title
      tabInfo.title = title
      log.debug(`[WindowManager] Tab 标题更新: tabId=${tabId}, title=${title}`)

      // 发送 tab:updated 事件
      eventBus.emit(EventTypes.TAB_UPDATED, {
        windowId: tabInfo.windowId,
        tabId,
        updates: {
          title,
          url: tabInfo.url
        },
        previous: {
          title: oldTitle,
          url: tabInfo.url
        }
      })
    })

    // did-navigate: 页面导航
    webContents.on(WebContentsEvents.DID_NAVIGATE, (_event, url) => {
      const oldUrl = tabInfo.url
      tabInfo.url = url
      log.debug(`[WindowManager] Tab 导航: tabId=${tabId}, url=${url}`)

      // 发送 tab:updated 事件
      eventBus.emit(EventTypes.TAB_UPDATED, {
        windowId: tabInfo.windowId,
        tabId,
        updates: {
          title: tabInfo.title,
          url
        },
        previous: {
          title: tabInfo.title,
          url: oldUrl
        }
      })
    })

    // page-favicon-updated: 图标更新
    webContents.on(WebContentsEvents.PAGE_FAVICON_UPDATED, (_event, favicons) => {
      if (favicons.length > 0) {
        tabInfo.icon = favicons[0]
        log.debug(`[WindowManager] Tab 图标更新: tabId=${tabId}`)

        // 发送 tab:updated 事件（icon 变化不包含在 updates 中，因为前端主要关注 title/url）
        eventBus.emit(EventTypes.TAB_UPDATED, {
          windowId: tabInfo.windowId,
          tabId,
          updates: {
            title: tabInfo.title,
            url: tabInfo.url
          },
          previous: {
            title: tabInfo.title,
            url: tabInfo.url
          }
        })
      }
    })

    // destroyed: webContents 销毁时自动清理
    webContents.once(WebContentsEvents.DESTROYED, () => {
      log.debug(`[WindowManager] WebContents 已销毁: tabId=${tabId}`)
      // 事件监听器会自动清理
    })
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
        const tabViewInfo = windowInfo.tabViews.get(tabId)

        // ✅ 关键修复：移除所有事件监听器，打破循环引用
        if (tabViewInfo && !tabViewInfo.view.webContents.isDestroyed()) {
          tabViewInfo.view.webContents.removeAllListeners()
          log.debug(`[WindowManager] 已移除 Tab 的所有事件监听器: tabId=${tabId}`)
        }

        windowInfo.tabs.delete(tabId)
        windowInfo.tabViews.delete(tabId)
      }
    }

    // 清理 webContents 映射
    this.webContentsToTabId.delete(tabId)
  }
}
