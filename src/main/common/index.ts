// 统一类型导出
export * from './types';

// 核心模块
export { Env } from './env';
export { log, createLogger, getLogPath, setLogPath } from './logger';

// 平台相关
export {
  getAppVersion,
  getDeviceInfo,
  getCPUUsage,
  getMemoryUsage,
  getDiskSpace,
  selectDirectory,
  selectFiles,
  restartApp,
  getHardwareSerialNumbers,
  getMachineId
} from './platform';

// 托盘管理
export { trayManager } from './tray';
export { eventBus } from './eventbus';
export { config, Config } from './config';
export { stateManager, StateManager } from './state';
export { ThemeManager } from './theme';
export { IconManager, getAppIcon, getTrayNativeImage } from './icons';

// 窗口事件（从 window 模块导出）
export { BrowserWindowEvents } from './window';

// 模块扫描
export { scanProcessors, scanJobs, scanApis, scanLifeCycleHooks, filterModules } from './scan';

// 数据库模块
export * from './database';

// 任务调度模块
export * from './job';

// 迁移模块
export * from './migration';

// 生命周期管理
export { LifecycleManager } from './lifecycle';

// 应用管理
export { AppManager } from './app';
export { ElectronAppEvents } from './app/types';
export type { IAppManager } from './app/types';

// IPC 模块
export {
  ShellChannels,
  WindowChannels,
  registerIpcHandlers,
  registerShellHandlers,
  registerWindowHandlers
} from './ipc';
export type { ShellChannel, WindowChannel } from './ipc';
