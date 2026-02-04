/**
 * 窗口和 Tab 管理相关类型定义
 */

import { join } from 'node:path'
import type { BrowserWindow, BrowserWindowConstructorOptions, WebContentsView } from 'electron'

// ==================== 窗口类型定义 ====================

/**
 * 窗口类型
 * - agent: AI Agent 交互窗口（主要窗口，支持 chat、task、settings 等 Tab）
 * - browser: 浏览器窗口（用于网页浏览，支持 webpage Tab）
 */
export type WindowType = 'agent' | 'browser'

/**
 * 窗口配置
 */
export interface WindowConfig {
  /** 窗口类型 */
  type: WindowType
  /** 窗口宽度 */
  width?: number
  /** 窗口高度 */
  height?: number
  /** 最小宽度 */
  minWidth?: number
  /** 最小高度 */
  minHeight?: number
  /** 是否显示边框 */
  frame?: boolean
  /** 是否透明 */
  transparent?: boolean
  /** 初始加载的 URL */
  initialUrl?: string
  /** 是否可调整大小 */
  resizable?: boolean
  /** 是否始终置顶 */
  alwaysOnTop?: boolean
  /** 其他元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 窗口信息
 */
export interface WindowInfo {
  /** 窗口 ID */
  id: number
  /** 窗口类型 */
  type: WindowType
  /** BrowserWindow 实例 */
  window: BrowserWindow
  /** 是否为主窗口 */
  isMain: boolean
  /** 创建时间 */
  createdAt: Date
  /** 元数据 */
  metadata?: Record<string, unknown>
  /** 窗口状态 */
  state: WindowState
  /** Tab 信息列表 */
  tabs: Map<number, TabInfo>
  /** TabView 实例列表 */
  tabViews: Map<number, TabViewInfo>
}

/**
 * 窗口预设配置类型
 *
 * 为每种窗口类型定义默认的 BrowserWindow 配置
 * - agent: Agent 窗口（AI 助手主窗口）- 1200x800
 * - browser: 浏览器窗口（网页浏览）- 1024x768
 */
export type WindowPresets = Record<WindowType, Partial<BrowserWindowConstructorOptions>>

/**
 * 窗口预设配置
 */
export const WINDOW_PRESETS: WindowPresets = {
  agent: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  },
  browser: {
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}

/**
 * 窗口状态
 */
export interface WindowState {
  /** 是否最小化 */
  isMinimized: boolean
  /** 是否最大化 */
  isMaximized: boolean
  /** 是否全屏 */
  isFullScreen: boolean
  /** 是否聚焦 */
  isFocused: boolean
  /** 是否可见 */
  isVisible: boolean
}

/**
 * 窗口边界
 */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

// ==================== Tab 类型定义 ====================

/**
 * Tab Bar（Chrome）固定高度
 *
 * 注意：如果未来需要动态调整高度（紧凑/舒适模式），可以改为变量
 */
export const CHROME_HEIGHT = 60

/**
 * Tab 配置
 */
export interface TabConfig {
  /** 初始 URL，默认 '/' */
  url?: string
  /** Tab 标题 */
  title?: string
  /** Tab 图标 */
  icon?: string
  /** 是否激活，默认 false */
  active?: boolean
  /** 是否可关闭，默认 true */
  closable?: boolean
  /** 其他元数据 */
  metadata?: Record<string, unknown>
}

/**
 * Tab 信息
 */
export interface TabInfo {
  /** Tab ID (使用 webContents.id) */
  id: number
  /** 所属窗口 ID */
  windowId: number
  /** WebContentsView 实例 */
  view: WebContentsView
  /** 当前 URL */
  url: string
  /** Tab 标题 */
  title: string
  /** Tab 图标 */
  icon?: string
  /** 是否激活 */
  isActive: boolean
  /** 位置顺序 */
  position: number
  /** 是否可关闭 */
  closable: boolean
  /** 创建时间 */
  createdAt: Date
  /** 元数据 */
  metadata?: Record<string, unknown>
}

/**
 * Tab 数据（用于 IPC 通信，不包含 view 实例）
 */
export interface TabData {
  /** Tab ID */
  id: number
  /** Tab 标题 */
  title: string
  /** Tab 图标 */
  icon?: string
  /** 当前 URL */
  url: string
  /** 是否激活 */
  isActive: boolean
  /** 位置顺序 */
  position: number
  /** 是否可关闭 */
  closable: boolean
}

/**
 * TabView 信息（包含 WebContentsView 实例）
 */
export interface TabViewInfo {
  /** TabView ID */
  id: number
  /** 所属窗口 ID */
  windowId: number
  /** Tab 信息 ID */
  tabId: number
  /** WebContentsView 实例 */
  view: WebContentsView
}

/**
 * Tab 边界
 */
export interface TabBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Chrome（Tab Bar）配置
 */
export interface ChromeConfig {
  /** Chrome 高度 */
  height: number
  /** 是否可见 */
  visible: boolean
}

// ==================== 管理器接口定义 ====================

/**
 * 窗口管理器接口（对外暴露）
 *
 * 统一管理窗口和 Tab，提供完整的窗口 + Tab 管理能力
 */
export interface IWindowManager {
  // ==================== 窗口创建 ====================

  /**
   * 创建新窗口
   * @param config 窗口配置
   * @returns BrowserWindow 实例，创建失败返回 null
   */
  createWindow(config: WindowConfig): BrowserWindow | null

  // ==================== 窗口查询 ====================

  /**
   * 根据 ID 获取窗口
   * @param windowId 窗口 ID
   * @returns BrowserWindow 实例
   */
  getWindow(windowId: number): BrowserWindow | undefined

  /**
   * 获取主窗口
   * @returns 主窗口实例
   */
  getMainWindow(): BrowserWindow | undefined

  /**
   * 获取当前聚焦的窗口
   * @returns 聚焦窗口实例
   */
  getFocusedWindow(): BrowserWindow | undefined

  /**
   * 获取所有窗口
   * @returns 所有窗口实例数组
   */
  getAllWindows(): BrowserWindow[]

  /**
   * 根据类型获取窗口
   * @param type 窗口类型
   * @returns 该类型的所有窗口
   */
  getWindowsByType(type: WindowType): BrowserWindow[]

  /**
   * 获取窗口信息
   * @param windowId 窗口 ID
   * @returns 窗口信息
   */
  getWindowInfo(windowId: number): WindowInfo | undefined

  /**
   * 获取窗口数量
   * @returns 窗口数量
   */
  getWindowCount(): number

  // ==================== 窗口操作 ====================

  /**
   * 关闭窗口
   * @param windowId 窗口 ID
   * @returns 是否成功关闭
   */
  closeWindow(windowId: number): Promise<boolean>

  /**
   * 聚焦窗口
   * @param windowId 窗口 ID
   * @returns 是否成功聚焦
   */
  focusWindow(windowId: number): boolean

  /**
   * 最小化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最小化
   */
  minimizeWindow(windowId: number): boolean

  /**
   * 最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功最大化
   */
  maximizeWindow(windowId: number): boolean

  /**
   * 取消最大化窗口
   * @param windowId 窗口 ID
   * @returns 是否成功取消最大化
   */
  unmaximizeWindow(windowId: number): boolean

  /**
   * 全屏窗口
   * @param windowId 窗口 ID
   * @param fullscreen 是否全屏
   * @returns 是否成功设置全屏
   */
  setFullScreen(windowId: number, fullscreen: boolean): boolean

  /**
   * 显示窗口
   * @param windowId 窗口 ID
   * @returns 是否成功显示
   */
  showWindow(windowId: number): boolean

  /**
   * 隐藏窗口
   * @param windowId 窗口 ID
   * @returns 是否成功隐藏
   */
  hideWindow(windowId: number): boolean

  // ==================== 窗口状态 ====================

  /**
   * 获取窗口状态
   * @param windowId 窗口 ID
   * @returns 窗口状态
   */
  getWindowState(windowId: number): WindowState | null

  /**
   * 获取窗口边界
   * @param windowId 窗口 ID
   * @returns 窗口边界
   */
  getWindowBounds(windowId: number): WindowBounds | null

  /**
   * 设置窗口边界
   * @param windowId 窗口 ID
   * @param bounds 窗口边界
   * @returns 是否成功设置
   */
  setWindowBounds(windowId: number, bounds: Partial<WindowBounds>): boolean

  // ==================== 窗口通信 ====================

  /**
   * 向指定窗口发送消息
   * @param windowId 窗口 ID
   * @param channel 通道名称
   * @param args 参数
   */
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void

  /**
   * 向所有窗口广播消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToAllWindows(channel: string, ...args: unknown[]): void

  /**
   * 向聚焦窗口发送消息
   * @param channel 通道名称
   * @param args 参数
   */
  sendToFocused(channel: string, ...args: unknown[]): void

  // ==================== Tab 管理 ====================

  /**
   * 创建新 Tab
   * @param windowId 目标窗口 ID
   * @param config Tab 配置
   * @returns Tab ID，创建失败返回 null
   */
  createTab(windowId: number, config: TabConfig): Promise<number | null>

  /**
   * 切换激活的 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功切换
   */
  switchTab(windowId: number, tabId: number): Promise<boolean>

  /**
   * 关闭 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功关闭
   */
  closeTab(windowId: number, tabId: number): Promise<boolean>

  /**
   * 重新排序 Tab
   * @param windowId 窗口 ID
   * @param tabIds 新的 Tab ID 顺序
   * @returns 是否成功重新排序
   */
  reorderTabs(windowId: number, tabIds: number[]): Promise<boolean>

  /**
   * 将 Tab 移动到另一个窗口
   * @param tabId Tab ID
   * @param fromWindowId 源窗口 ID
   * @param toWindowId 目标窗口 ID
   * @returns 是否成功移动
   */
  moveTabToWindow(tabId: number, fromWindowId: number, toWindowId: number): Promise<boolean>

  /**
   * 复制 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 新 Tab 的 ID，失败返回 null
   */
  duplicateTab(windowId: number, tabId: number): Promise<number | null>

  /**
   * 刷新 Tab
   * @param windowId 窗口 ID
   * @param tabId Tab ID
   * @returns 是否成功刷新
   */
  reloadTab(windowId: number, tabId: number): boolean

  // ==================== Tab 查询 ====================

  /**
   * 获取 Tab 信息
   * @param tabId Tab ID
   * @returns Tab 信息
   */
  getTabInfo(tabId: number): TabInfo | undefined

  /**
   * 获取窗口的所有 Tab
   * @param windowId 窗口 ID
   * @returns Tab 信息数组
   */
  getWindowTabs(windowId: number): TabInfo[]

  /**
   * 获取窗口的激活 Tab
   * @param windowId 窗口 ID
   * @returns 激活的 Tab 信息
   */
  getActiveTab(windowId: number): TabInfo | undefined

  /**
   * 获取窗口的 Tab 数量
   * @param windowId 窗口 ID
   * @returns Tab 数量
   */
  getWindowTabCount(windowId: number): number

  /**
   * 根据 WebContents ID 获取 Tab ID
   * @param webContentsId WebContents ID
   * @returns Tab ID
   */
  getTabIdByWebContentsId(webContentsId: number): number | undefined
}
