/**
 * 共享常量
 * 主进程和渲染进程都可以使用
 */

export const APP_NAME = 'Coobee AI'
export const APP_VERSION = '1.0.0'

export const DEFAULT_WINDOW_WIDTH = 1200
export const DEFAULT_WINDOW_HEIGHT = 800

export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto'
} as const

export const IPC_CHANNELS = {
  // 日志
  LOG_INFO: 'log:info',
  LOG_ERROR: 'log:error',
  
  // 存储
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',
  
  // 更新
  CHECK_FOR_UPDATES: 'check-for-updates',
  
  // 窗口
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
} as const
