/**
 * API Request/Response Types
 */

/**
 * 请求控制选项
 */
export interface RequestOptions {
  timeout?: number
  method?: 'get' | 'post'
  useQs?: boolean
}

/**
 * 统一请求包装对象（前后端共享）
 */
export interface UnifiedRequest {
  args: unknown[]
  options?: RequestOptions
  requestId: string
  timestamp: number
}

/**
 * 通用响应接口
 */
export interface Result<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  code?: string
  timestamp?: number
}

/**
 * Stream 数据流结果类型
 */
export interface StreamData<T = unknown> {
  chunk: T
  isLast?: boolean
  metadata?: {
    contentType?: string
    filename?: string
    size?: number
    progress?: number
    contentDisposition?: 'inline' | 'attachment'
    cacheControl?: string
    etag?: string
    contentRange?: string
    customHeaders?: Record<string, string>
    statusCode?: number
    [key: string]: unknown
  }
}

/**
 * 错误码类
 */
export class ErrorCode {
  constructor(
    public code: string,
    public message: string,
    public status: number
  ) {}

  static of(code: string, message: string, status: number = 500): ErrorCode {
    return new ErrorCode(code, message, status)
  }
}

/**
 * 错误码对象集合
 */
export const ErrorCodes = {
  SYSTEM_ERROR: ErrorCode.of('100-000-000', '系统内部错误', 200),
  MAINTENANCE_MODE: ErrorCode.of('100-000-001', '系统维护中', 200)
} as const

export type ErrorCodeKey = keyof typeof ErrorCodes
