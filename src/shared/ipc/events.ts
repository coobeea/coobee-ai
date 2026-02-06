/**
 * IPC 事件类型定义和 Payload
 * 统一管理所有事件类型，确保类型安全
 */

/**
 * 事件类型常量
 */
export const EventTypes = {
  // ==================== Window 事件 ====================
  /** 窗口创建 */
  WINDOW_CREATED: 'window:created',
  /** 窗口准备就绪（内容加载完成，可以显示） */
  WINDOW_READY: 'window:ready',
  /** 窗口显示 */
  WINDOW_SHOW: 'window:show',
  /** 窗口隐藏 */
  WINDOW_HIDE: 'window:hide',
  /** 窗口即将关闭（可阻止） */
  WINDOW_CLOSE: 'window:close',
  /** 窗口已关闭 */
  WINDOW_CLOSED: 'window:closed',
  /** 窗口获得焦点 */
  WINDOW_FOCUSED: 'window:focused',
  /** 窗口失去焦点 */
  WINDOW_BLURRED: 'window:blurred',
  /** 窗口最小化 */
  WINDOW_MINIMIZED: 'window:minimized',
  /** 窗口最大化 */
  WINDOW_MAXIMIZED: 'window:maximized',
  /** 窗口取消最大化 */
  WINDOW_UNMAXIMIZED: 'window:unmaximized',
  /** 窗口恢复 */
  WINDOW_RESTORED: 'window:restored',
  /** 窗口进入全屏 */
  WINDOW_ENTER_FULL_SCREEN: 'window:enter-full-screen',
  /** 窗口离开全屏 */
  WINDOW_LEAVE_FULL_SCREEN: 'window:leave-full-screen',
  /** 窗口大小变化 */
  WINDOW_RESIZED: 'window:resized',

  // ==================== Tab 事件 ====================
  /** Tab 创建 */
  TAB_CREATED: 'tab:created',
  /** Tab 关闭 */
  TAB_CLOSED: 'tab:closed',
  /** Tab 激活 */
  TAB_ACTIVATED: 'tab:activated',
  /** Tab 更新 */
  TAB_UPDATED: 'tab:updated',
  /** Tab 移动 */
  TAB_MOVED: 'tab:moved',
  /** Tabs 重新排序（批量移动）*/
  TABS_REORDERED: 'tabs:reordered',
  /** Tab 移动到另一个窗口 */
  TAB_MOVED_TO_WINDOW: 'tab:moved-to-window',
  /** Tab 复制 */
  TAB_DUPLICATED: 'tab:duplicated',
  /** Tab 刷新 */
  TAB_RELOADED: 'tab:reloaded',

  // ==================== App 事件 ====================
  /** 应用激活（macOS Dock 图标点击） */
  APP_ACTIVATED: 'app:activated',
  /** 应用获得焦点 */
  APP_FOCUS: 'app:focus',
  /** 应用即将退出 */
  APP_BEFORE_QUIT: 'app:before-quit',
  /** 第二个实例启动 */
  APP_SECOND_INSTANCE: 'app:second-instance',
  /** 子进程崩溃 */
  APP_CHILD_PROCESS_GONE: 'app:child-process-gone',
  /** 系统错误 */
  SYSTEM_ERROR: 'system:error',

  // ==================== UI 操作事件 ====================
  /** 跳转到设置页 */
  UI_GO_SETTINGS: 'ui:go-settings',
  /** 创建新窗口 */
  UI_CREATE_WINDOW: 'ui:create-window',

  // ==================== Config 配置事件 ====================
  /** 主题配置变更 */
  CONFIG_THEME_CHANGED: 'config:theme:changed',
  /** 自动启动配置变更 */
  CONFIG_AUTO_START_CHANGED: 'config:autoStart:changed',
  /** 启动到托盘配置变更 */
  CONFIG_START_TO_TRAY_CHANGED: 'config:startToTray:changed',
  /** 关闭到托盘配置变更 */
  CONFIG_CLOSE_TO_TRAY_CHANGED: 'config:closeToTray:changed',
  /** 语言配置变更 */
  CONFIG_LANGUAGE_CHANGED: 'config:language:changed',
  /** 自动更新配置变更 */
  CONFIG_AUTO_UPDATE_CHANGED: 'config:autoUpdate:changed',
  /** Beta 更新配置变更 */
  CONFIG_BETA_UPDATES_CHANGED: 'config:betaUpdates:changed',
  /** 内存限制配置变更 */
  CONFIG_MEMORY_LIMIT_CHANGED: 'config:memoryLimit:changed',
  /** 硬件加速配置变更 */
  CONFIG_HARDWARE_ACCELERATION_CHANGED: 'config:hardwareAcceleration:changed',
  /** 显示托盘图标配置变更 */
  CONFIG_SHOW_TRAY_ICON_CHANGED: 'config:showTrayIcon:changed',
  /** 音效配置变更 */
  CONFIG_SOUND_EFFECTS_CHANGED: 'config:soundEffects:changed',
  /** 窗口置顶配置变更 */
  CONFIG_ALWAYS_ON_TOP_CHANGED: 'config:alwaysOnTop:changed',
  /** 工作区路径配置变更 */
  CONFIG_WORKSPACE_PATH_CHANGED: 'config:workspacePath:changed',
  /** 备份路径配置变更 */
  CONFIG_BACKUP_PATH_CHANGED: 'config:backupPath:changed',
  /** 日志路径配置变更 */
  CONFIG_LOG_PATH_CHANGED: 'config:logPath:changed',
  /** 快捷键配置变更 */
  CONFIG_SHORTCUTS_CHANGED: 'config:shortcuts:changed'
} as const

/**
 * 事件类型（用于 TypeScript 类型推断）
 */
export type EventType = (typeof EventTypes)[keyof typeof EventTypes]

/**
 * 事件 Payload 类型映射
 */
export interface EventPayloads {
  // ==================== Window 事件 ====================
  [EventTypes.WINDOW_CREATED]: {
    windowId: number
    type: string
  }
  [EventTypes.WINDOW_READY]: {
    windowId: number
  }
  [EventTypes.WINDOW_SHOW]: {
    windowId: number
  }
  [EventTypes.WINDOW_HIDE]: {
    windowId: number
  }
  [EventTypes.WINDOW_CLOSE]: {
    windowId: number
  }
  [EventTypes.WINDOW_CLOSED]: {
    windowId: number
  }
  [EventTypes.WINDOW_FOCUSED]: {
    windowId: number
  }
  [EventTypes.WINDOW_BLURRED]: {
    windowId: number
  }
  [EventTypes.WINDOW_MINIMIZED]: {
    windowId: number
  }
  [EventTypes.WINDOW_MAXIMIZED]: {
    windowId: number
  }
  [EventTypes.WINDOW_UNMAXIMIZED]: {
    windowId: number
  }
  [EventTypes.WINDOW_RESTORED]: {
    windowId: number
  }
  [EventTypes.WINDOW_ENTER_FULL_SCREEN]: {
    windowId: number
  }
  [EventTypes.WINDOW_LEAVE_FULL_SCREEN]: {
    windowId: number
  }
  [EventTypes.WINDOW_RESIZED]: {
    windowId: number
    bounds: { width: number; height: number; x: number; y: number }
  }

  // ==================== Tab 事件 ====================
  [EventTypes.TAB_CREATED]: {
    windowId: number
    tabId: number
    title: string
    url: string
    position: number
  }
  [EventTypes.TAB_CLOSED]: {
    windowId: number
    tabId: number
  }
  [EventTypes.TAB_ACTIVATED]: {
    windowId: number
    tabId: number
    previousTabId: number | null
  }
  [EventTypes.TAB_UPDATED]: {
    windowId: number
    tabId: number
    title?: string
    url?: string
  }
  [EventTypes.TAB_MOVED]: {
    windowId: number
    tabId: number
    fromPosition: number
    toPosition: number
  }
  [EventTypes.TABS_REORDERED]: {
    windowId: number
    /** 新的 Tab 顺序（Tab ID 数组）*/
    tabIds: number[]
    /** 每个 Tab 的位置变化信息 */
    changes: Array<{
      tabId: number
      fromPosition: number
      toPosition: number
    }>
  }
  [EventTypes.TAB_MOVED_TO_WINDOW]: {
    tabId: number
    fromWindowId: number
    toWindowId: number
    title: string
  }
  [EventTypes.TAB_DUPLICATED]: {
    windowId: number
    originalTabId: number
    newTabId: number
    title: string
  }
  [EventTypes.TAB_RELOADED]: {
    windowId: number
    tabId: number
  }

  // ==================== App 事件 ====================
  [EventTypes.APP_ACTIVATED]: {
    hasWindows: boolean
  }
  [EventTypes.APP_FOCUS]: {
    timestamp: number
  }
  [EventTypes.APP_BEFORE_QUIT]: {
    timestamp: number
  }
  [EventTypes.APP_SECOND_INSTANCE]: {
    hasWindows: boolean
  }
  [EventTypes.APP_CHILD_PROCESS_GONE]: {
    type: string
    reason: string
    exitCode: number
  }
  [EventTypes.SYSTEM_ERROR]: {
    code: string
    message: string
    details?: unknown
  }

  // ==================== UI 操作事件 ====================
  [EventTypes.UI_GO_SETTINGS]: {
    timestamp: number
  }
  [EventTypes.UI_CREATE_WINDOW]: {
    timestamp: number
  }

  // ==================== Config 配置事件 ====================
  [EventTypes.CONFIG_THEME_CHANGED]: {
    theme: 'light' | 'dark' | 'auto'
  }
  [EventTypes.CONFIG_AUTO_START_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_START_TO_TRAY_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_CLOSE_TO_TRAY_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_LANGUAGE_CHANGED]: {
    language: string
  }
  [EventTypes.CONFIG_AUTO_UPDATE_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_BETA_UPDATES_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_MEMORY_LIMIT_CHANGED]: {
    limit: number
  }
  [EventTypes.CONFIG_HARDWARE_ACCELERATION_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_SHOW_TRAY_ICON_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_SOUND_EFFECTS_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_ALWAYS_ON_TOP_CHANGED]: {
    value: boolean
  }
  [EventTypes.CONFIG_WORKSPACE_PATH_CHANGED]: {
    path: string
  }
  [EventTypes.CONFIG_BACKUP_PATH_CHANGED]: {
    path: string
  }
  [EventTypes.CONFIG_LOG_PATH_CHANGED]: {
    path: string
  }
  [EventTypes.CONFIG_SHORTCUTS_CHANGED]: {
    shortcuts: Array<{
      key: string
      shortcut: string
      editable: boolean
      enabled: boolean
      global: boolean
      registered: boolean
    }>
  }
}

/**
 * 统一的 IPC 事件消息格式
 */
export interface IpcEventMessage<T extends keyof EventPayloads = keyof EventPayloads> {
  /** 事件类型 */
  type: T
  /** 事件负载 */
  payload: EventPayloads[T]
  /** 事件时间戳 */
  timestamp: number
}

/**
 * 类型安全的事件处理器
 */
export type EventHandler<T extends keyof EventPayloads> = (payload: EventPayloads[T]) => void

/**
 * 通用事件处理器（用于 mitt）
 */
export type GenericEventHandler = (payload: unknown) => void
