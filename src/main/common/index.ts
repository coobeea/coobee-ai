// 统一类型导出
export * from './types'

// 核心模块
export { Env } from './env'
export { log, createLogger, getLogPath, setLogPath } from './logger'
export { eventBus } from './eventbus'
export { config, Config } from './config'
export { stateManager, StateManager } from './state'
export { dialogManager, DialogManager } from './dialog'
export { ThemeManager } from './theme'
export { IconManager, getAppIcon, getTrayIcon, getTrayNativeImage, validateIcons } from './icons'
export {
  AppEvents,
  WindowEvents,
  LifecycleEvents,
  DatabaseEvents,
  WorkspaceEvents,
  JobEvents,
  ThemeEvents,
  ConfigEvents,
  LogEvents
} from './events'

// 窗口事件（从 window 模块导出）
export { BrowserWindowEvents } from './window'

// 模块扫描
export { scanProcessors, scanJobs, scanApis, scanLifeCycleHooks, filterModules } from './scan'

// 数据库模块
export * from './database'

// 任务调度模块
export * from './job'

// 中间件模块
export * from './middleware'

// 迁移模块
export * from './migration'

// 工作区管理
export { WorkspaceManager, workspaceManager } from './workspace'

// 生命周期管理
export { LifecycleManager } from './lifecycle'

// 应用管理
export { AppManager } from './app'
export { ElectronAppEvents } from './app/types'
export type { IAppManager } from './app/types'
