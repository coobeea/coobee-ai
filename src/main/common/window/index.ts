/**
 * 窗口管理模块导出
 */

// 窗口管理器（对外唯一接口）
export { WindowManager } from './WindowManager'

// 常量定义
export { CHROME_HEIGHT, WINDOW_PRESETS } from './types'

// 所有类型定义
export type {
  // 窗口类型
  WindowType,
  WindowConfig,
  WindowInfo,
  WindowPresets,
  WindowState,
  WindowBounds,
  // Tab 类型
  TabConfig,
  TabInfo,
  TabData,
  TabBounds,
  ChromeConfig,
  // 管理器接口（仅导出 IWindowManager）
  IWindowManager
} from './types'

// 注意：TabManager 和 ITabManager 不对外暴露，仅供内部使用
