/**
 * IPC 通道名称常量（前后端共用）
 *
 * 命名规范：前缀:动作
 * - shell: Shell 窗口相关（拉取/下发）
 * - window: 窗口控制（渲染进程 -> 主进程）
 */

/** Shell 相关通道（invoke 拉取 / on 下发） */
export const ShellChannels = {
  /** 拉取当前窗口 ID */
  GET_WINDOW_ID: 'shell:get-window-id',
  /** 渲染进程上报 Chrome 高度（AppBar + Toolbar） */
  CHROME_HEIGHT: 'shell:chrome-height'
} as const

/** 窗口控制通道（渲染进程 send，主进程 on） */
export const WindowChannels = {
  /** 最小化窗口 */
  MINIMIZE: 'window:minimize',
  /** 最大化/还原窗口 */
  MAXIMIZE: 'window:maximize',
  /** 关闭窗口 */
  CLOSE: 'window:close'
} as const

export type ShellChannel = (typeof ShellChannels)[keyof typeof ShellChannels]
export type WindowChannel = (typeof WindowChannels)[keyof typeof WindowChannels]
