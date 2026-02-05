/**
 * IPC 通道名称常量（前后端共用）
 *
 * 命名规范：前缀:动作
 * - shell: Shell 窗口相关（invoke 拉取）
 * - window: 窗口控制（invoke）
 * - tab: Tab 操作（invoke）
 * - on: 事件监听（on 监听，主进程 -> 渲染进程）
 */

/** Shell 相关通道（invoke 拉取） */
export const ShellChannels = {
  /** 拉取当前窗口完整信息（windowId、tabs、currentTabId 等） */
  GET_WINDOW_INFO: 'shell:get-window-info'
} as const

/** 窗口控制通道（invoke） */
export const WindowChannels = {
  /** 最小化窗口 */
  MINIMIZE: 'window:minimize',
  /** 最大化/还原窗口 */
  MAXIMIZE: 'window:maximize',
  /** 关闭窗口 */
  CLOSE: 'window:close'
} as const

/** Tab 操作通道（invoke） */
export const TabChannels = {
  /** 创建 Tab */
  CREATE: 'tab:create',
  /** 关闭 Tab */
  CLOSE: 'tab:close',
  /** 切换 Tab */
  SWITCH: 'tab:switch',
  /** 更新 Tab */
  UPDATE: 'tab:update'
} as const

/** 事件监听通道（on 监听） */
export const EventChannels = {
  /** Tab 列表更新 */
  TABS_UPDATED: 'event:tabs-updated',
  /** Tab 激活 */
  TAB_ACTIVATED: 'event:tab-activated',
  /** Tab 关闭 */
  TAB_CLOSED: 'event:tab-closed'
} as const

// 类型导出
export type ShellChannel = (typeof ShellChannels)[keyof typeof ShellChannels]
export type WindowChannel = (typeof WindowChannels)[keyof typeof WindowChannels]
export type TabChannel = (typeof TabChannels)[keyof typeof TabChannels]
export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels]
