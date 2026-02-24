/**
 * 统一错误处理器
 *
 * 职责：
 * - 捕获和记录错误
 * - 格式化错误输出
 * - 错误上报（可选）
 * - 错误恢复策略
 */

import { log } from '@main/common/logger';
import { CoobeeError } from './CoobeeError';
import { ErrorCode, ErrorSeverity } from './ErrorCodes';

/** 错误处理选项 */
export interface ErrorHandlerOptions {
  /** 是否记录到日志 */
  logError?: boolean;

  /** 是否上报到监控系统 */
  reportError?: boolean;

  /** 是否重试 */
  shouldRetry?: boolean;

  /** 最大重试次数 */
  maxRetries?: number;

  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

/**
 * 统一错误处理器
 */
export class ErrorHandler {
  /**
   * 处理错误
   */
  static handle(error: unknown, options: ErrorHandlerOptions = {}): CoobeeError {
    const { logError = true, reportError = false, shouldRetry = false, maxRetries = 3, retryDelay = 1000 } = options;

    // 转换为 CoobeeError
    const coobeeError = this.normalize(error);

    // 记录错误
    if (logError) {
      this.logError(coobeeError);
    }

    // 上报错误
    if (reportError) {
      this.reportError(coobeeError);
    }

    // 重试逻辑（由调用方实现，这里只返回是否应该重试）
    if (shouldRetry && coobeeError.retriable) {
      log.warn(`[ErrorHandler] 错误可重试: ${coobeeError.code}, 最大重试次数: ${maxRetries}, 延迟: ${retryDelay}ms`);
    }

    return coobeeError;
  }

  /**
   * 规范化错误为 CoobeeError
   */
  static normalize(error: unknown): CoobeeError {
    // 已经是 CoobeeError
    if (error instanceof CoobeeError) {
      return error;
    }

    // 是原生 Error
    if (error instanceof Error) {
      // Node.js 系统错误
      if ('code' in error && typeof (error as NodeJS.ErrnoException).code === 'string') {
        return CoobeeError.fromNodeError(error as NodeJS.ErrnoException);
      }

      // 普通 Error
      return CoobeeError.fromError(error);
    }

    // 字符串错误
    if (typeof error === 'string') {
      return new CoobeeError({
        code: ErrorCode.UNKNOWN_ERROR,
        message: error
      });
    }

    // 对象错误（可能来自第三方库）
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      return new CoobeeError({
        code: ErrorCode.UNKNOWN_ERROR,
        message: obj.message?.toString() || JSON.stringify(error)
      });
    }

    // 其他未知类型
    return new CoobeeError({
      code: ErrorCode.UNKNOWN_ERROR,
      message: String(error)
    });
  }

  /**
   * 记录错误到日志
   */
  private static logError(error: CoobeeError): void {
    const logLevel = this.getLogLevel(error.severity);

    // 构建日志消息
    const logMessage = [
      `[CoobeeError] ${error.message}`,
      `Code: ${error.code}`,
      `Severity: ${error.severity}`,
      error.retriable ? 'Retriable: yes' : 'Retriable: no',
      error.context ? `Context: ${JSON.stringify(error.context)}` : '',
      error.cause ? `Cause: ${error.cause.message}` : ''
    ]
      .filter(Boolean)
      .join(' | ');

    // 根据严重级别选择日志方法
    switch (logLevel) {
      case 'error':
        log.error(logMessage, error);
        break;
      case 'warn':
        log.warn(logMessage);
        break;
      default:
        log.info(logMessage);
    }
  }

  /**
   * 获取日志级别
   */
  private static getLogLevel(severity: ErrorSeverity): 'error' | 'warn' | 'info' {
    switch (severity) {
      case ErrorSeverity.FATAL:
      case ErrorSeverity.ERROR:
        return 'error';
      case ErrorSeverity.WARNING:
        return 'warn';
      default:
        return 'info';
    }
  }

  /**
   * 上报错误到监控系统
   */
  private static reportError(error: CoobeeError): void {
    // TODO: 集成错误监控系统（如 Sentry）
    log.debug(`[ErrorHandler] 上报错误: ${error.code} - ${error.message}`);
  }

  /**
   * 带重试的异步函数包装器
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      onRetry?: (error: CoobeeError, attempt: number) => void;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 1000, onRetry } = options;

    let lastError: CoobeeError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = this.normalize(error);

        // 如果不可重试，直接抛出
        if (!lastError.retriable) {
          throw lastError;
        }

        // 如果是最后一次尝试，抛出错误
        if (attempt === maxRetries) {
          log.error(`[ErrorHandler] 重试 ${maxRetries} 次后仍失败: ${lastError.message}`);
          throw lastError;
        }

        // 通知调用方即将重试
        if (onRetry) {
          onRetry(lastError, attempt + 1);
        }

        // 等待后重试
        log.warn(`[ErrorHandler] 重试 ${attempt + 1}/${maxRetries}: ${lastError.message}，延迟 ${retryDelay}ms`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }

    throw lastError!;
  }
}
