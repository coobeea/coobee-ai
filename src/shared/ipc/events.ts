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
  /** 窗口关闭 */
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
  /** 主题切换 */
  THEME_CHANGED: 'theme:changed',
  /** 配置更新 */
  CONFIG_UPDATED: 'config:updated',
  /** 系统错误 */
  SYSTEM_ERROR: 'system:error'
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
  [EventTypes.THEME_CHANGED]: {
    theme: 'light' | 'dark'
  }
  [EventTypes.CONFIG_UPDATED]: {
    key: string
    value: unknown
  }
  [EventTypes.SYSTEM_ERROR]: {
    code: string
    message: string
    details?: unknown
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
