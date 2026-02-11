/**
 * Common 模块统一类型定义
 *
 * 此文件包含所有 common 模块的类型定义，按功能模块分组
 */

import { ErrorCode, UnifiedRequest } from '@shared/types'

// ==================== 通用类型 ====================

/**
 * 主题模式
 */
export type ThemeMode = 'light' | 'dark' | 'auto'

// ==================== 生命周期 ====================

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
  phase: LifecyclePhase
  manager: unknown
  data?: Record<string, unknown>
}

/**
 * 生命周期 Hook
 */
export interface LifecycleHook {
  name: string
  phase: LifecyclePhase
  priority: number
  critical: boolean
  execute: (context: LifecycleContext) => Promise<void | boolean>
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

// ==================== 数据库 ====================

/**
 * SQL 错误
 */
export class SqlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlError'
  }
}

/**
 * 数据库连接接口
 */
export interface IConnection {
  execute(sql: string, params?: unknown[]): Promise<number>
  insert(sql: string, params?: unknown[]): Promise<number>
  update(sql: string, params?: unknown[]): Promise<number>
  delete(sql: string, params?: unknown[]): Promise<number>
  query(sql: string, params?: unknown[]): Promise<unknown[]>
  transaction<T>(fn: (tx: IConnection) => Promise<T>): Promise<T>
  getDbPath(): string
}

// ==================== 任务调度 ====================

/**
 * 定时任务配置
 */
export interface CronJobConfig {
  id: string
  name: string
  description?: string
  cron: string
  enabled: boolean
  data?: unknown
  options?: CronJobOptions
}

/**
 * 定时任务选项
 */
export interface CronJobOptions {
  timezone?: string
  maxRetries?: number
  retryDelay?: number
  timeout?: number
  runOnInit?: boolean
}

/**
 * 任务执行结果
 */
export interface JobExecutionResult {
  jobId: string
  startTime: number
  endTime: number
  duration: number
  success: boolean
  data?: unknown
  error?: string
  retryCount?: number
}

/**
 * 任务状态
 */
export enum JobStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  DISABLED = 'disabled'
}

/**
 * 任务运行时信息
 */
export interface JobRuntimeInfo {
  config: CronJobConfig
  status: JobStatus
  nextRun?: Date
  lastRun?: Date
  lastResult?: JobExecutionResult
  totalRuns: number
  successRuns: number
  failedRuns: number
}

/**
 * 任务执行上下文
 */
export interface JobExecutionContext {
  jobId: string
  jobName: string
  startTime: number
  data?: unknown
  cancelled: boolean
  retryCount: number
}

/**
 * 任务结果
 */
export interface TaskResult {
  taskId: string
  success: boolean
  data?: unknown
  error?: string
  duration: number
  completedAt: number
}

// ==================== 中间件 ====================

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  method: string
  args: unknown[]
  metadata?: Record<string, unknown>
}

/**
 * 中间件结果
 */
export interface MiddlewareResult {
  success: boolean
  data?: unknown
  error?: Error
}

/**
 * 中间件接口
 */
export interface Middleware {
  name: string
  priority: number
  execute: (
    context: MiddlewareContext,
    next: () => Promise<MiddlewareResult>
  ) => Promise<MiddlewareResult>
}

// ==================== 数据库迁移 ====================

/**
 * 数据库迁移接口
 */
export interface Migration {
  version: number
  description: string
  up: (dbService: unknown) => Promise<void>
  down: (dbService: unknown) => Promise<void>
  dependencies?: number[]
  isBreaking?: boolean
}

/**
 * 迁移历史记录
 */
export interface MigrationHistory {
  version: number
  description: string
  appliedAt: string
}

/**
 * 数据库状态
 */
export interface DatabaseStatus {
  currentVersion: number
  latestVersion: number
  pendingMigrations: number
  history: MigrationHistory[]
}

/**
 * 迁移执行结果
 */
export interface MigrationResult {
  success: boolean
  version: number
  description: string
  error?: Error
  executionTime: number
}

// ==================== 状态管理 ====================

/**
 * 应用状态接口
 */
export interface State {
  /** 维护模式 */
  maintenanceMode: boolean
  /** 应用是否正在退出 */
  isQuitting: boolean
}

// ==================== 模块扫描 ====================

/**
 * 发现的模块
 */
export interface DiscoveredModule {
  path: string
  module: Record<string, unknown>
  exportName?: string
}

// ==================== 工作区管理 ====================

/**
 * 工作区大小进度事件
 */
export interface WorkspaceSizeProgressEvent {
  type: 'progress' | 'complete'
  processedFiles: number
  processedDirs: number
  currentSize: number
  currentPath: string
  formattedSize: string
  totalSize?: number
}

/**
 * 工作区复制进度事件
 */
export interface WorkspaceCopyProgressEvent {
  type: 'scanning' | 'copying' | 'complete' | 'error'
  totalFiles?: number
  totalDirs?: number
  copiedFiles: number
  copiedDirs: number
  currentFile?: string
  totalSize?: number
  copiedSize: number
  formattedTotalSize?: string
  formattedCopiedSize?: string
  speed?: number
  estimatedTimeRemaining?: number
  percentage?: number
  formattedSpeed?: string
  elapsedTime?: number
  error?: string
}

/**
 * 文件复制信息
 */
export interface FileCopyInfo {
  sourcePath: string
  targetPath: string
  size: number
  isDirectory: boolean
}

// ==================== 执行环境 ====================

export type ExecutionEnvironment = 'http' | 'ipc'

// ==================== 业务异常 ====================

export class BusinessError extends Error {
  errorCode: ErrorCode

  private constructor(
    errorCode: ErrorCode,
    public status: number = 200
  ) {
    super(errorCode.message)
    this.errorCode = errorCode
    this.name = 'BusinessError'
  }

  static useErrorCode(errorCode: ErrorCode, status: number = 200): BusinessError {
    return new BusinessError(errorCode, status)
  }

  static useErrorMessage(message: string, code?: string, status: number = 200): BusinessError {
    return new BusinessError(ErrorCode.of(code || message, message), status)
  }
}

// ==================== 请求上下文 ====================

/**
 * 请求上下文 - 框架内部使用，同时也作为业务函数参数
 */
export interface RequestContext {
  /** 执行环境：http 或 ipc */
  environment: ExecutionEnvironment
  /** 是否为 SSE 流式请求 */
  isSSE: boolean
  /** 请求路径（HTTP）或通道名称（IPC） */
  path: string
  /** 目标类实例 */
  target: unknown
  /** 方法名 */
  propertyKey: string
  /** 请求 ID */
  requestId: string
  /** 时间戳 */
  timestamp: number
  /** 流式通道（仅 SSE 请求） */
  streamChannel?: string
  /** 原始请求数据 */
  rawRequest?: UnifiedRequest
  /** 原始响应对象 */
  rawResponse?: unknown
  /** 用户数据（认证后填充） */
  user?: UserInfo
  /** 额外数据 */
  extra?: Record<string, unknown>
  /** 取消信号（仅 SSE 请求，供业务逻辑使用） */
  signal?: AbortSignal
}

// ==================== 用户信息 ====================

export interface UserInfo {
  id: string
  name: string
  isAdmin: boolean
}

// ==================== 服务端中间件 ====================

/**
 * 服务端中间件上下文
 * 注意：与 MiddlewareContext 不同，这里专用于 HTTP/IPC 服务端
 */
export interface ServerMiddlewareContext {
  /** 请求上下文 */
  requestContext: RequestContext
  /** 原始请求数据 */
  request: UnifiedRequest
  /** 用户信息（认证后填充） */
  user?: {
    id: string
    name: string
    isAdmin: boolean
    token: string
  }
  /** 中间件间共享数据 */
  shared: Record<string, unknown>
}
