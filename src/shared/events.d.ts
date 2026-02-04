/**
 * 应用事件定义
 *
 * 事件命名规范：
 * - 使用统一前缀进行分类（app:、window:、lifecycle: 等）
 * - 使用小写字母和连字符（kebab-case）
 * - 事件名称应清晰描述事件的含义
 */

// ==================== 应用级别事件 ====================

/**
 * 应用级别事件
 * 前缀：app:
 */
export enum AppEvents {
  /** 应用激活（macOS 特有，点击 dock 图标时触发） */
  ACTIVATE = 'app:activate',

  /** 创建浏览器窗口时触发 */
  BROWSER_WINDOW_CREATED = 'app:browser-window-created',

  /** 浏览器窗口获得焦点时触发 */
  BROWSER_WINDOW_FOCUS = 'app:browser-window-focus',

  /** 应用即将退出时触发 */
  BEFORE_QUIT = 'app:before-quit',

  /** 应用将要退出时触发 */
  WILL_QUIT = 'app:will-quit',

  /** 所有窗口关闭时触发 */
  WINDOW_ALL_CLOSED = 'app:window-all-closed',

  /** 第二个实例启动时触发（单实例应用） */
  SECOND_INSTANCE = 'app:second-instance',

  /** 渲染进程崩溃时触发 */
  RENDER_PROCESS_GONE = 'app:render-process-gone',

  /** 子进程消失时触发 */
  CHILD_PROCESS_GONE = 'app:child-process-gone'
}

// ==================== 窗口事件 ====================

/**
 * 主窗口事件
 * 前缀：window:
 */
export enum WindowEvents {
  /** 主窗口准备显示 */
  READY_TO_SHOW = 'window:ready-to-show',

  /** 主窗口显示 */
  SHOW = 'window:show',

  /** 主窗口隐藏 */
  HIDE = 'window:hide',

  /** 主窗口关闭中 */
  CLOSE = 'window:close',

  /** 主窗口已关闭 */
  CLOSED = 'window:closed',

  /** 主窗口最小化 */
  MINIMIZE = 'window:minimize',

  /** 主窗口最大化 */
  MAXIMIZE = 'window:maximize',

  /** 主窗口取消最大化 */
  UNMAXIMIZE = 'window:unmaximize',

  /** 主窗口恢复 */
  RESTORE = 'window:restore',

  /** 主窗口大小调整中 */
  RESIZE = 'window:resize',

  /** 主窗口大小已调整 */
  RESIZED = 'window:resized',

  /** 主窗口移动中 */
  MOVE = 'window:move',

  /** 主窗口已移动 */
  MOVED = 'window:moved',

  /** 主窗口获得焦点 */
  FOCUS = 'window:focus',

  /** 主窗口失去焦点 */
  BLUR = 'window:blur',

  /** 主窗口进入全屏 */
  ENTER_FULL_SCREEN = 'window:enter-full-screen',

  /** 主窗口离开全屏 */
  LEAVE_FULL_SCREEN = 'window:leave-full-screen',

  /** 主窗口进入 HTML 全屏 */
  ENTER_HTML_FULL_SCREEN = 'window:enter-html-full-screen',

  /** 主窗口离开 HTML 全屏 */
  LEAVE_HTML_FULL_SCREEN = 'window:leave-html-full-screen',

  /** 主窗口置顶状态改变 */
  ALWAYS_ON_TOP_CHANGED = 'window:always-on-top-changed',

  /** 主窗口响应 */
  RESPONSIVE = 'window:responsive',

  /** 主窗口无响应 */
  UNRESPONSIVE = 'window:unresponsive'
}

// ==================== 生命周期事件 ====================

/**
 * 生命周期事件
 * 前缀：lifecycle:
 */
export enum LifecycleEvents {
  /** 初始化阶段开始 */
  INIT_START = 'lifecycle:init-start',

  /** 初始化阶段完成 */
  INIT_COMPLETE = 'lifecycle:init-complete',

  /** 就绪阶段开始 */
  READY_START = 'lifecycle:ready-start',

  /** 就绪阶段完成 */
  READY_COMPLETE = 'lifecycle:ready-complete',

  /** 退出前阶段开始 */
  BEFORE_QUIT_START = 'lifecycle:before-quit-start',

  /** 退出前阶段完成 */
  BEFORE_QUIT_COMPLETE = 'lifecycle:before-quit-complete'
}

// ==================== 数据库事件 ====================

/**
 * 数据库事件
 * 前缀：db:
 */
export enum DatabaseEvents {
  /** 数据库连接已建立 */
  CONNECTED = 'db:connected',

  /** 数据库连接已断开 */
  DISCONNECTED = 'db:disconnected',

  /** 数据库连接错误 */
  CONNECTION_ERROR = 'db:connection-error',

  /** 数据库迁移开始 */
  MIGRATION_START = 'db:migration-start',

  /** 数据库迁移完成 */
  MIGRATION_COMPLETE = 'db:migration-complete',

  /** 数据库迁移失败 */
  MIGRATION_ERROR = 'db:migration-error'
}

// ==================== 工作区事件 ====================

/**
 * 工作区事件
 * 前缀：workspace:
 */
export enum WorkspaceEvents {
  /** 工作区已加载 */
  LOADED = 'workspace:loaded',

  /** 工作区已关闭 */
  CLOSED = 'workspace:closed',

  /** 工作区已更改 */
  CHANGED = 'workspace:changed',

  /** 工作区扫描开始 */
  SCAN_START = 'workspace:scan-start',

  /** 工作区扫描进度 */
  SCAN_PROGRESS = 'workspace:scan-progress',

  /** 工作区扫描完成 */
  SCAN_COMPLETE = 'workspace:scan-complete',

  /** 工作区复制开始 */
  COPY_START = 'workspace:copy-start',

  /** 工作区复制进度 */
  COPY_PROGRESS = 'workspace:copy-progress',

  /** 工作区复制完成 */
  COPY_COMPLETE = 'workspace:copy-complete'
}

// ==================== 任务事件 ====================

/**
 * 任务/作业事件
 * 前缀：job:
 */
export enum JobEvents {
  /** 任务已注册 */
  REGISTERED = 'job:registered',

  /** 任务启动 */
  START = 'job:start',

  /** 任务完成 */
  COMPLETE = 'job:complete',

  /** 任务失败 */
  FAILED = 'job:failed',

  /** 任务取消 */
  CANCELLED = 'job:cancelled',

  /** 任务进度更新 */
  PROGRESS = 'job:progress'
}

// ==================== 主题事件 ====================

/**
 * 主题事件
 * 前缀：theme:
 */
export enum ThemeEvents {
  /** 主题已更改 */
  CHANGED = 'theme:changed',

  /** 系统主题已更改 */
  SYSTEM_CHANGED = 'theme:system-changed'
}

// ==================== 配置事件 ====================

/**
 * 配置事件
 * 前缀：config:
 */
export enum ConfigEvents {
  /** 配置已加载 */
  LOADED = 'config:loaded',

  /** 配置已更改 */
  CHANGED = 'config:changed',

  /** 配置已重置 */
  RESET = 'config:reset',

  /** 配置保存失败 */
  SAVE_ERROR = 'config:save-error'
}

// ==================== 日志事件 ====================

/**
 * 日志事件
 * 前缀：log:
 */
export enum LogEvents {
  /** 信息日志 */
  INFO = 'log:info',

  /** 警告日志 */
  WARN = 'log:warn',

  /** 错误日志 */
  ERROR = 'log:error',

  /** 调试日志 */
  DEBUG = 'log:debug'
}

// ==================== 类型导出 ====================

/**
 * 所有事件类型的联合类型
 */
export type AllEvents =
  | AppEvents
  | WindowEvents
  | LifecycleEvents
  | DatabaseEvents
  | WorkspaceEvents
  | JobEvents
  | ThemeEvents
  | ConfigEvents
  | LogEvents

/**
 * 事件负载类型映射
 */
export interface EventPayloads {
  // 应用事件
  [AppEvents.ACTIVATE]: void
  [AppEvents.BROWSER_WINDOW_CREATED]: { windowId: number }
  [AppEvents.BROWSER_WINDOW_FOCUS]: { windowId: number }
  [AppEvents.BEFORE_QUIT]: void
  [AppEvents.WILL_QUIT]: void
  [AppEvents.WINDOW_ALL_CLOSED]: void
  [AppEvents.SECOND_INSTANCE]: { argv: string[]; workingDirectory: string }
  [AppEvents.RENDER_PROCESS_GONE]: { details: unknown }
  [AppEvents.CHILD_PROCESS_GONE]: { details: unknown }

  // 窗口事件
  [WindowEvents.READY_TO_SHOW]: void
  [WindowEvents.SHOW]: void
  [WindowEvents.HIDE]: void
  [WindowEvents.CLOSE]: void
  [WindowEvents.CLOSED]: void
  [WindowEvents.MINIMIZE]: void
  [WindowEvents.MAXIMIZE]: void
  [WindowEvents.UNMAXIMIZE]: void
  [WindowEvents.RESTORE]: void
  [WindowEvents.RESIZE]: { width: number; height: number }
  [WindowEvents.RESIZED]: { width: number; height: number }
  [WindowEvents.MOVE]: { x: number; y: number }
  [WindowEvents.MOVED]: { x: number; y: number }
  [WindowEvents.FOCUS]: void
  [WindowEvents.BLUR]: void
  [WindowEvents.ENTER_FULL_SCREEN]: void
  [WindowEvents.LEAVE_FULL_SCREEN]: void
  [WindowEvents.ENTER_HTML_FULL_SCREEN]: void
  [WindowEvents.LEAVE_HTML_FULL_SCREEN]: void
  [WindowEvents.ALWAYS_ON_TOP_CHANGED]: { isAlwaysOnTop: boolean }
  [WindowEvents.RESPONSIVE]: void
  [WindowEvents.UNRESPONSIVE]: void

  // 生命周期事件
  [LifecycleEvents.INIT_START]: void
  [LifecycleEvents.INIT_COMPLETE]: void
  [LifecycleEvents.READY_START]: void
  [LifecycleEvents.READY_COMPLETE]: void
  [LifecycleEvents.BEFORE_QUIT_START]: void
  [LifecycleEvents.BEFORE_QUIT_COMPLETE]: void

  // 数据库事件
  [DatabaseEvents.CONNECTED]: { dbPath: string }
  [DatabaseEvents.DISCONNECTED]: void
  [DatabaseEvents.CONNECTION_ERROR]: { error: Error }
  [DatabaseEvents.MIGRATION_START]: { version: number }
  [DatabaseEvents.MIGRATION_COMPLETE]: { version: number }
  [DatabaseEvents.MIGRATION_ERROR]: { error: Error }

  // 工作区事件
  [WorkspaceEvents.LOADED]: { path: string }
  [WorkspaceEvents.CLOSED]: void
  [WorkspaceEvents.CHANGED]: { path: string }
  [WorkspaceEvents.SCAN_START]: { path: string }
  [WorkspaceEvents.SCAN_PROGRESS]: { current: number; total: number }
  [WorkspaceEvents.SCAN_COMPLETE]: { path: string; totalFiles: number }
  [WorkspaceEvents.COPY_START]: { source: string; target: string }
  [WorkspaceEvents.COPY_PROGRESS]: { current: number; total: number }
  [WorkspaceEvents.COPY_COMPLETE]: { source: string; target: string }

  // 任务事件
  [JobEvents.REGISTERED]: { jobId: string; jobName: string }
  [JobEvents.START]: { jobId: string }
  [JobEvents.COMPLETE]: { jobId: string; result: unknown }
  [JobEvents.FAILED]: { jobId: string; error: Error }
  [JobEvents.CANCELLED]: { jobId: string }
  [JobEvents.PROGRESS]: { jobId: string; progress: number }

  // 主题事件
  [ThemeEvents.CHANGED]: { theme: 'light' | 'dark' | 'auto' }
  [ThemeEvents.SYSTEM_CHANGED]: { theme: 'light' | 'dark' }

  // 配置事件
  [ConfigEvents.LOADED]: void
  [ConfigEvents.CHANGED]: { key: string; value: unknown }
  [ConfigEvents.RESET]: void
  [ConfigEvents.SAVE_ERROR]: { error: Error }

  // 日志事件
  [LogEvents.INFO]: { message: string; data?: unknown }
  [LogEvents.WARN]: { message: string; data?: unknown }
  [LogEvents.ERROR]: { message: string; error?: Error }
  [LogEvents.DEBUG]: { message: string; data?: unknown }
}
