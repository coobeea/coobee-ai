/**
 * Coobee 统一错误类
 *
 * 继承自 Error，添加错误码、严重级别、上下文等信息
 */

import { ErrorCode, ERROR_MESSAGES, ErrorSeverity, RETRIABLE_ERRORS } from './ErrorCodes';

/** 错误上下文 */
export interface ErrorContext {
  /** 会话 ID */
  sessionId?: string;

  /** Agent ID */
  agentId?: string;

  /** 工具名称 */
  toolName?: string;

  /** 文件路径 */
  filePath?: string;

  /** 其他上下文信息 */
  [key: string]: unknown;
}

/**
 * Coobee 统一错误类
 */
export class CoobeeError extends Error {
  /** 错误码 */
  public readonly code: ErrorCode;

  /** 严重级别 */
  public readonly severity: ErrorSeverity;

  /** 是否可重试 */
  public readonly retriable: boolean;

  /** 错误上下文 */
  public readonly context?: ErrorContext;

  /** 原始错误 */
  public readonly cause?: Error;

  /** 错误堆栈（可选） */
  public readonly stack?: string;

  constructor(options: {
    code: ErrorCode;
    message?: string;
    severity?: ErrorSeverity;
    context?: ErrorContext;
    cause?: Error;
  }) {
    // 使用默认消息或自定义消息
    const message = options.message || ERROR_MESSAGES[options.code] || '未知错误';
    super(message);

    this.name = 'CoobeeError';
    this.code = options.code;
    this.severity = options.severity || this.inferSeverity(options.code);
    this.retriable = RETRIABLE_ERRORS.has(options.code);
    this.context = options.context;
    this.cause = options.cause;

    // 保留错误堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CoobeeError);
    }
  }

  /**
   * 推断错误严重级别
   */
  private inferSeverity(code: ErrorCode): ErrorSeverity {
    // Fatal: 配置错误、系统错误
    if (code >= 1000 && code < 2000) return ErrorSeverity.FATAL;
    if (code >= 9000) return ErrorSeverity.FATAL;

    // Warning: 部分网络错误、LLM 提供商错误
    if (
      code === ErrorCode.RATE_LIMIT_EXCEEDED ||
      code === ErrorCode.SERVICE_UNAVAILABLE ||
      code === ErrorCode.MODEL_UNAVAILABLE
    ) {
      return ErrorSeverity.WARNING;
    }

    // Error: 其他所有错误
    return ErrorSeverity.ERROR;
  }

  /**
   * 转换为 JSON 格式
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      retriable: this.retriable,
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message
          }
        : undefined,
      stack: this.stack
    };
  }

  /**
   * 转换为用户友好的字符串
   */
  toUserString(): string {
    let msg = `[${this.code}] ${this.message}`;

    if (this.context) {
      const contextParts: string[] = [];
      if (this.context.sessionId) contextParts.push(`会话: ${this.context.sessionId}`);
      if (this.context.agentId) contextParts.push(`Agent: ${this.context.agentId}`);
      if (this.context.toolName) contextParts.push(`工具: ${this.context.toolName}`);
      if (this.context.filePath) contextParts.push(`文件: ${this.context.filePath}`);

      if (contextParts.length > 0) {
        msg += ` (${contextParts.join(', ')})`;
      }
    }

    if (this.cause) {
      msg += `\n原因: ${this.cause.message}`;
    }

    return msg;
  }

  /**
   * 静态工厂方法：从原生 Error 创建 CoobeeError
   */
  static fromError(
    error: Error,
    options?: {
      code?: ErrorCode;
      severity?: ErrorSeverity;
      context?: ErrorContext;
    }
  ): CoobeeError {
    if (error instanceof CoobeeError) {
      return error;
    }

    return new CoobeeError({
      code: options?.code || ErrorCode.UNKNOWN_ERROR,
      message: error.message,
      severity: options?.severity,
      context: options?.context,
      cause: error
    });
  }

  /**
   * 静态工厂方法：从 Node.js 系统错误创建 CoobeeError
   */
  static fromNodeError(error: NodeJS.ErrnoException, context?: ErrorContext): CoobeeError {
    let code: ErrorCode;

    switch (error.code) {
      case 'ENOENT':
        code = ErrorCode.FILE_NOT_FOUND;
        break;
      case 'EEXIST':
        code = ErrorCode.FILE_ALREADY_EXISTS;
        break;
      case 'EACCES':
      case 'EPERM':
        code = ErrorCode.FILE_PERMISSION_DENIED;
        break;
      case 'ENOTDIR':
        code = ErrorCode.DIRECTORY_NOT_FOUND;
        break;
      case 'ENOTEMPTY':
        code = ErrorCode.DIRECTORY_NOT_EMPTY;
        break;
      case 'ETIMEDOUT':
        code = ErrorCode.NETWORK_TIMEOUT;
        break;
      case 'ECONNREFUSED':
        code = ErrorCode.CONNECTION_REFUSED;
        break;
      case 'ENOTFOUND':
        code = ErrorCode.DNS_LOOKUP_FAILED;
        break;
      default:
        code = ErrorCode.INTERNAL_ERROR;
    }

    return new CoobeeError({
      code,
      message: error.message,
      context,
      cause: error
    });
  }
}
