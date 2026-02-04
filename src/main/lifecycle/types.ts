/**
 * 生命周期类型定义
 */

/**
 * 生命周期阶段
 */
export enum LifecyclePhase {
  /** 初始化阶段 - 应用启动时执行 */
  INIT = 'init',
  /** 就绪阶段 - Electron ready 后执行 */
  READY = 'ready',
  /** 退出前阶段 - 应用退出前执行 */
  BEFORE_QUIT = 'before-quit'
}

/**
 * 生命周期上下文
 */
export interface LifecycleContext {
  /** 当前阶段 */
  phase: LifecyclePhase
  /** 生命周期管理器 */
  manager: ILifecycleManager
  /** 自定义数据 */
  data?: Record<string, unknown>
}

/**
 * 生命周期 Hook
 */
export interface LifecycleHook {
  /** Hook 名称 */
  name: string
  /** 所属阶段 */
  phase: LifecyclePhase
  /** 优先级 (数字越小越先执行) */
  priority: number
  /** 是否关键 (关键 Hook 失败会中断流程) */
  critical: boolean
  /** 执行函数 */
  execute: (context: LifecycleContext) => Promise<void | boolean>
}

/**
 * 生命周期管理器接口
 */
export interface ILifecycleManager {
  /** 启动生命周期管理 */
  start(): Promise<void>
  /** 注册 Hook */
  registerHook(hook: LifecycleHook): string
  /** 请求关闭应用 */
  requestShutdown(): Promise<boolean>
}

/**
 * Hook 执行结果
 */
export interface LifecycleHookExecutionResult {
  hookId: string
  hook: LifecycleHook
  success: boolean
  error?: Error
  result?: void | boolean
}
