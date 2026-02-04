/**
 * 窗口和 Tab 相关事件定义
 */

/**
 * 窗口事件
 */
export const WindowEvents = {
  // 窗口生命周期
  CREATED: 'window:created',
  CLOSED: 'window:closed',
  READY_TO_SHOW: 'window:ready-to-show',

  // 窗口状态
  FOCUS: 'window:focus',
  BLUR: 'window:blur',
  MINIMIZE: 'window:minimize',
  MAXIMIZE: 'window:maximize',
  UNMAXIMIZE: 'window:unmaximize',
  ENTER_FULL_SCREEN: 'window:enter-full-screen',
  LEAVE_FULL_SCREEN: 'window:leave-full-screen',

  // 窗口变化
  RESIZE: 'window:resize',
  MOVE: 'window:move',
  RESIZED: 'window:resized',
  MOVED: 'window:moved'
} as const

/**
 * Tab 事件
 */
export const TabEvents = {
  // Tab 生命周期
  CREATED: 'tab:created',
  CLOSED: 'tab:closed',

  // Tab 操作
  SWITCHED: 'tab:switched',
  REORDERED: 'tab:reordered',
  MOVED: 'tab:moved',
  DUPLICATED: 'tab:duplicated',

  // Tab 内容
  TITLE_UPDATED: 'tab:title-updated',
  URL_CHANGED: 'tab:url-changed',
  LOADING_START: 'tab:loading-start',
  LOADING_STOP: 'tab:loading-stop',

  // Tab 状态
  CRASHED: 'tab:crashed'
} as const

/**
 * 窗口事件数据类型
 */
export interface WindowEventData {
  [WindowEvents.CREATED]: {
    windowId: number
    type: string
  }
  [WindowEvents.CLOSED]: {
    windowId: number
  }
  [WindowEvents.READY_TO_SHOW]: {
    windowId: number
  }
  [WindowEvents.FOCUS]: {
    windowId: number
  }
  [WindowEvents.BLUR]: {
    windowId: number
  }
  [WindowEvents.MINIMIZE]: {
    windowId: number
  }
  [WindowEvents.MAXIMIZE]: {
    windowId: number
  }
  [WindowEvents.UNMAXIMIZE]: {
    windowId: number
  }
  [WindowEvents.ENTER_FULL_SCREEN]: {
    windowId: number
  }
  [WindowEvents.LEAVE_FULL_SCREEN]: {
    windowId: number
  }
  [WindowEvents.RESIZE]: {
    windowId: number
  }
  [WindowEvents.MOVE]: {
    windowId: number
  }
  [WindowEvents.RESIZED]: {
    windowId: number
    width: number
    height: number
  }
  [WindowEvents.MOVED]: {
    windowId: number
    x: number
    y: number
  }
}

/**
 * Tab 事件数据类型
 */
export interface TabEventData {
  [TabEvents.CREATED]: {
    tabId: number
    windowId: number
    type: string
  }
  [TabEvents.CLOSED]: {
    tabId: number
    windowId: number
  }
  [TabEvents.SWITCHED]: {
    tabId: number
    windowId: number
  }
  [TabEvents.REORDERED]: {
    windowId: number
    tabIds: number[]
  }
  [TabEvents.MOVED]: {
    tabId: number
    fromWindowId: number
    toWindowId: number
  }
  [TabEvents.DUPLICATED]: {
    originalTabId: number
    newTabId: number
    windowId: number
  }
  [TabEvents.TITLE_UPDATED]: {
    tabId: number
    title: string
  }
  [TabEvents.URL_CHANGED]: {
    tabId: number
    url: string
  }
  [TabEvents.LOADING_START]: {
    tabId: number
  }
  [TabEvents.LOADING_STOP]: {
    tabId: number
  }
  [TabEvents.CRASHED]: {
    tabId: number
    reason: string
  }
}
