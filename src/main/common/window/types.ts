/**
 * 窗口和 Tab 管理相关类型定义
 */

import { join } from 'node:path'
import type { BrowserWindow, BrowserWindowConstructorOptions, WebContentsView } from 'electron'

// ==================== 窗口事件定义 ====================

/**
 * BrowserWindow 事件枚举
 *
 * 定义所有窗口相关的事件名称，避免硬编码字符串
 */
export enum BrowserWindowEvents {
  // 窗口生命周期事件
  READY_TO_SHOW = 'ready-to-show', // 窗口准备显示时触发
  SHOW = 'show', // 窗口显示时触发
  HIDE = 'hide', // 窗口隐藏时触发
  CLOSE = 'close', // 窗口关闭时触发（可以阻止）
  CLOSED = 'closed', // 窗口已关闭时触发

  // 窗口状态变化事件
  MINIMIZE = 'minimize', // 窗口最小化时触发
  MAXIMIZE = 'maximize', // 窗口最大化时触发
  UNMAXIMIZE = 'unmaximize', // 窗口取消最大化时触发
  RESTORE = 'restore', // 窗口从最小化恢复时触发
  RESIZE = 'resize', // 窗口大小改变时触发
  RESIZED = 'resized', // 窗口大小改变完成时触发（macOS）
  MOVE = 'move', // 窗口位置改变时触发
  MOVED = 'moved', // 窗口位置改变完成时触发（macOS）

  // 焦点相关事件
  FOCUS = 'focus', // 窗口获得焦点时触发
  BLUR = 'blur', // 窗口失去焦点时触发

  // 全屏相关事件
  ENTER_FULL_SCREEN = 'enter-full-screen', // 进入全屏时触发
  LEAVE_FULL_SCREEN = 'leave-full-screen', // 退出全屏时触发
  ENTER_HTML_FULL_SCREEN = 'enter-html-full-screen', // 进入HTML全屏时触发
  LEAVE_HTML_FULL_SCREEN = 'leave-html-full-screen', // 退出HTML全屏时触发

  // 系统相关事件
  ALWAYS_ON_TOP_CHANGED = 'always-on-top-changed', // 置顶状态改变时触发
  APP_COMMAND = 'app-command', // 应用命令时触发（Windows）
  SWIPE = 'swipe', // 滑动手势时触发（macOS）
  ROTATE_GESTURE = 'rotate-gesture', // 旋转手势时触发（macOS）
  SHEET_BEGIN = 'sheet-begin', // 工作表开始时触发（macOS）
  SHEET_END = 'sheet-end', // 工作表结束时触发（macOS）
  NEW_WINDOW_FOR_TAB = 'new-window-for-tab', // 新标签页窗口时触发（macOS）
  SYSTEM_CONTEXT_MENU = 'system-context-menu', // 系统上下文菜单时触发（Windows）

  // 响应性相关事件
  RESPONSIVE = 'responsive', // 页面变为响应时触发
  UNRESPONSIVE = 'unresponsive', // 页面变为无响应时触发

  // 会话相关事件
  SESSION_END = 'session-end', // 会话结束时触发（Windows）

  // 滚动相关事件
  SCROLL_TOUCH_BEGIN = 'scroll-touch-begin', // 触摸滚动开始时触发
  SCROLL_TOUCH_END = 'scroll-touch-end', // 触摸滚动结束时触发
  SCROLL_TOUCH_EDGE = 'scroll-touch-edge' // 触摸滚动到边缘时触发
}

/**
 * WebContents 事件枚举
 *
 * 定义 WebContents (Tab 内容) 相关的事件名称
 */
export enum WebContentsEvents {
  // 页面生命周期事件
  DID_FINISH_LOAD = 'did-finish-load', // 页面加载完成
  DID_FAIL_LOAD = 'did-fail-load', // 页面加载失败
  DID_START_LOADING = 'did-start-loading', // 开始加载
  DID_STOP_LOADING = 'did-stop-loading', // 停止加载
  DESTROYED = 'destroyed', // WebContents 已销毁

  // 导航相关事件
  DID_NAVIGATE = 'did-navigate', // 页面导航完成
  DID_NAVIGATE_IN_PAGE = 'did-navigate-in-page', // 页面内导航（锚点跳转）
  WILL_NAVIGATE = 'will-navigate', // 即将导航（可阻止）
  DID_START_NAVIGATION = 'did-start-navigation', // 开始导航

  // 页面内容更新事件
  PAGE_TITLE_UPDATED = 'page-title-updated', // 页面标题更新
  PAGE_FAVICON_UPDATED = 'page-favicon-updated', // 页面图标更新
  DOM_READY = 'dom-ready', // DOM 加载完成

  // 控制台和调试事件
  CONSOLE_MESSAGE = 'console-message', // 控制台消息
  DEVTOOLS_OPENED = 'devtools-opened', // 开发者工具打开
  DEVTOOLS_CLOSED = 'devtools-closed', // 开发者工具关闭

  // 渲染进程相关事件
  RENDER_PROCESS_GONE = 'render-process-gone', // 渲染进程崩溃或被杀死
  UNRESPONSIVE = 'unresponsive', // 页面无响应
  RESPONSIVE = 'responsive', // 页面恢复响应

  // 新窗口相关事件
  NEW_WINDOW = 'new-window', // 新窗口请求（已废弃，使用 did-create-window）
  DID_CREATE_WINDOW = 'did-create-window', // 创建新窗口

  // 其他事件
  CONTEXT_MENU = 'context-menu', // 右键菜单
  MEDIA_STARTED_PLAYING = 'media-started-playing', // 媒体开始播放
  MEDIA_PAUSED = 'media-paused' // 媒体暂停
}

// ==================== 窗口类型定义 ====================

/**
 * 窗口类型
 * - agent: AI Agent 交互窗口（主要窗口，支持 chat、task、settings 等 Tab）
 * - browser: 浏览器窗口（用于网页浏览，支持 webpage Tab）
 * - console: 控制台窗口（用于监控和管理所有窗口状态）
 */
export type WindowType = 'agent' | 'browser' | 'console'

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
 * - console: 控制台窗口（窗口管理）- 1400x900
 */
export type WindowPresets = Record<WindowType, Partial<BrowserWindowConstructorOptions>>

/**
 * 窗口预设配置
 *
 * 注意：需要在运行时获取 isDev 状态来设置 webPreferences
 */
export function getWindowPresets(isDev: boolean): WindowPresets {
  // macOS 特殊配置
  const macOSConfig: Partial<BrowserWindowConstructorOptions> =
    process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 8, y: 10 }
        }
      : {}

  // webPreferences 配置
  const webPreferences = {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: !isDev, // 开发环境禁用，支持热重载
    allowRunningInsecureContent: isDev, // 开发环境允许
    experimentalFeatures: isDev // 开发环境启用
  }

  return {
    agent: {
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      frame: false, // 无边框
      transparent: false,
      resizable: true,
      backgroundColor: '#1a1a1a', // 深色背景，避免关闭时白屏
      ...macOSConfig,
      webPreferences
    },
    browser: {
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      frame: false, // 无边框
      transparent: false,
      resizable: true,
      backgroundColor: '#1a1a1a', // 深色背景，避免关闭时白屏
      ...macOSConfig,
      webPreferences
    },
    console: {
      width: 400, // 窄一点，像 QQ 控制面板
      height: 700, // 高一点
      minWidth: 350,
      minHeight: 500,
      frame: false, // 无边框
      transparent: false,
      resizable: false, // 不可缩放
      backgroundColor: '#f9fafb', // 浅色背景，匹配控制台界面
      title: 'Coobee AI 控制台',
      ...macOSConfig,
      webPreferences
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
 * 对应前端 AppBar 的 h-9 (36px)
 * 注意：如果未来需要动态调整高度（紧凑/舒适模式），可以改为变量
 */
export const CHROME_HEIGHT = 36

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

  /**
   * 创建控制台窗口（独立方法）
   * @returns BrowserWindow 实例，创建失败返回 null
   */
  createConsoleWindow(): BrowserWindow | null

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
