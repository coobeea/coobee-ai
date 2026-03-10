/**
 * 窗口管理模块导出
 */

// 窗口管理器（对外唯一接口）
export { WindowManager } from './WindowManager';

// 创建并导出 windowManager 单例
import { WindowManager } from './WindowManager';
export const windowManager = new WindowManager();

// 常量定义
export { CHROME_HEIGHT, getWindowPresets, BrowserWindowEvents } from './types';

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
} from './types';
