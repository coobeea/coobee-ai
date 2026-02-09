/**
 * AI 模块统一错误类
 */

/**
 * 基础 AI 错误类
 */
export class AIError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AIError'
    Error.captureStackTrace?.(this, this.constructor)
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * 配置错误
 */
export class ConfigError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', details)
    this.name = 'ConfigError'
  }
}

/**
 * 初始化错误
 */
export class InitializationError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'INITIALIZATION_ERROR', details)
    this.name = 'InitializationError'
  }
}

/**
 * 执行错误
 */
export class ExecutionError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'EXECUTION_ERROR', details)
    this.name = 'ExecutionError'
  }
}

/**
 * 计划错误
 */
export class PlanningError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'PLANNING_ERROR', details)
    this.name = 'PlanningError'
  }
}

/**
 * Worker 错误
 */
export class WorkerError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'WORKER_ERROR', details)
    this.name = 'WorkerError'
  }
}

/**
 * 验证错误
 */
export class VerificationError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'VERIFICATION_ERROR', details)
    this.name = 'VerificationError'
  }
}

/**
 * 存储错误
 */
export class StorageError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'STORAGE_ERROR', details)
    this.name = 'StorageError'
  }
}

/**
 * 记忆错误
 */
export class MemoryError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'MEMORY_ERROR', details)
    this.name = 'MemoryError'
  }
}

/**
 * 流式错误
 */
export class StreamError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'STREAM_ERROR', details)
    this.name = 'StreamError'
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'TIMEOUT_ERROR', details)
    this.name = 'TimeoutError'
  }
}

/**
 * 资源错误
 */
export class ResourceError extends AIError {
  constructor(message: string, details?: unknown) {
    super(message, 'RESOURCE_ERROR', details)
    this.name = 'ResourceError'
  }
}

/**
 * 验证器：检查是否为 AI 错误
 */
export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError
}

/**
 * 错误包装器：将未知错误转换为 AIError
 */
export function wrapError(error: unknown, defaultMessage: string): AIError {
  if (isAIError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new AIError(error.message, 'UNKNOWN_ERROR', {
      originalError: error,
      stack: error.stack
    })
  }

  return new AIError(defaultMessage, 'UNKNOWN_ERROR', {
    originalError: error
  })
}

/**
 * 错误日志辅助函数
 */
export function logError(
  moduleName: string,
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (isAIError(error)) {
    console.error(`[${moduleName}] ${operation} failed:`, {
      code: error.code,
      message: error.message,
      details: error.details,
      context
    })
  } else if (error instanceof Error) {
    console.error(`[${moduleName}] ${operation} failed:`, {
      message: error.message,
      stack: error.stack,
      context
    })
  } else {
    console.error(`[${moduleName}] ${operation} failed:`, {
      error,
      context
    })
  }
}
