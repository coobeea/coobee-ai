/**
 * Extension 错误边界
 *
 * 提供 Extension 错误隔离机制，防止单个 Extension 崩溃影响整个系统。
 */

import { createLogger } from '@main/common/logger';

const log = createLogger('extension-error-boundary');

/**
 * Extension 错误统计
 */
interface ExtensionErrorStats {
  extensionId: string;
  errorCount: number;
  lastError: {
    message: string;
    timestamp: number;
    stack?: string;
  } | null;
  firstErrorTime: number;
}

/**
 * Extension 错误边界管理器
 *
 * 单例，跟踪所有 Extension 的错误情况。
 */
export class ExtensionErrorBoundary {
  private static instance: ExtensionErrorBoundary | null = null;

  /** extensionId → 错误统计 */
  private errorStats = new Map<string, ExtensionErrorStats>();

  /** 错误阈值：1 分钟内超过 5 次错误则禁用 Extension */
  private readonly ERROR_THRESHOLD = 5;
  private readonly ERROR_WINDOW_MS = 60000; // 1 分钟

  /** 已禁用的 Extension ID 列表 */
  private disabledExtensions = new Set<string>();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ExtensionErrorBoundary {
    if (!ExtensionErrorBoundary.instance) {
      ExtensionErrorBoundary.instance = new ExtensionErrorBoundary();
    }
    return ExtensionErrorBoundary.instance;
  }

  /**
   * 包装 Extension 方法调用，提供错误隔离
   */
  async wrapAsync<T>(
    extensionId: string,
    operation: string,
    fn: () => Promise<T>,
    options: {
      /** 默认返回值（出错时） */
      defaultValue?: T;
      /** 是否静默（不记录错误） */
      silent?: boolean;
      /** 出错时是否禁用 Extension */
      disableOnError?: boolean;
    } = {}
  ): Promise<T | undefined> {
    const { defaultValue, silent = false, disableOnError = false } = options;

    // 如果 Extension 已被禁用，直接返回默认值
    if (this.disabledExtensions.has(extensionId)) {
      if (!silent) {
        log.warn(`[ErrorBoundary] Extension "${extensionId}" is disabled, skipping ${operation}`);
      }
      return defaultValue;
    }

    try {
      // 执行带超时的异步操作
      const timeoutMs = 30000; // 30 秒超时
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${operation} timeout (${timeoutMs}ms)`)), timeoutMs)
        )
      ]);

      // 成功后重置错误计数器（如果距离上次错误超过窗口期）
      this.resetErrorCountIfNeeded(extensionId);

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      if (!silent) {
        log.error(
          `[ErrorBoundary] Extension "${extensionId}" ${operation} failed:`,
          errorMsg,
          '\n[ISOLATION] Error isolated, system continues.'
        );
      }

      // 记录错误
      this.recordError(extensionId, errorMsg, stack);

      // 检查是否需要禁用 Extension
      if (disableOnError || this.shouldDisableExtension(extensionId)) {
        this.disableExtension(extensionId);
      }

      return defaultValue;
    }
  }

  /**
   * 包装同步方法调用
   */
  wrapSync<T>(
    extensionId: string,
    operation: string,
    fn: () => T,
    options: {
      defaultValue?: T;
      silent?: boolean;
    } = {}
  ): T | undefined {
    const { defaultValue, silent = false } = options;

    // 如果 Extension 已被禁用，直接返回默认值
    if (this.disabledExtensions.has(extensionId)) {
      if (!silent) {
        log.warn(`[ErrorBoundary] Extension "${extensionId}" is disabled, skipping ${operation}`);
      }
      return defaultValue;
    }

    try {
      const result = fn();
      this.resetErrorCountIfNeeded(extensionId);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      if (!silent) {
        log.error(
          `[ErrorBoundary] Extension "${extensionId}" ${operation} failed:`,
          errorMsg,
          '\n[ISOLATION] Error isolated, system continues.'
        );
      }

      this.recordError(extensionId, errorMsg, stack);

      if (this.shouldDisableExtension(extensionId)) {
        this.disableExtension(extensionId);
      }

      return defaultValue;
    }
  }

  /**
   * 记录错误
   */
  private recordError(extensionId: string, message: string, stack?: string): void {
    let stats = this.errorStats.get(extensionId);
    if (!stats) {
      stats = {
        extensionId,
        errorCount: 0,
        lastError: null,
        firstErrorTime: Date.now()
      };
      this.errorStats.set(extensionId, stats);
    }

    stats.errorCount++;
    stats.lastError = {
      message,
      timestamp: Date.now(),
      stack
    };
  }

  /**
   * 检查是否需要禁用 Extension
   */
  private shouldDisableExtension(extensionId: string): boolean {
    const stats = this.errorStats.get(extensionId);
    if (!stats) return false;

    const now = Date.now();
    const windowElapsed = now - stats.firstErrorTime;

    // 在时间窗口内，错误次数超过阈值
    if (windowElapsed < this.ERROR_WINDOW_MS && stats.errorCount >= this.ERROR_THRESHOLD) {
      return true;
    }

    return false;
  }

  /**
   * 禁用 Extension
   */
  private disableExtension(extensionId: string): void {
    this.disabledExtensions.add(extensionId);
    log.warn(
      `[ErrorBoundary] Extension "${extensionId}" disabled due to excessive errors (${this.errorStats.get(extensionId)?.errorCount} errors in ${this.ERROR_WINDOW_MS}ms)`
    );
  }

  /**
   * 重新启用 Extension
   */
  enableExtension(extensionId: string): void {
    if (this.disabledExtensions.delete(extensionId)) {
      log.info(`[ErrorBoundary] Extension "${extensionId}" re-enabled`);
      // 清空错误统计
      this.errorStats.delete(extensionId);
    }
  }

  /**
   * 重置错误计数（如果距离上次错误超过窗口期）
   */
  private resetErrorCountIfNeeded(extensionId: string): void {
    const stats = this.errorStats.get(extensionId);
    if (!stats) return;

    const now = Date.now();
    const windowElapsed = now - stats.firstErrorTime;

    // 超过窗口期，重置计数器
    if (windowElapsed > this.ERROR_WINDOW_MS) {
      this.errorStats.delete(extensionId);
    }
  }

  /**
   * 获取所有错误统计
   */
  getErrorStats(): ExtensionErrorStats[] {
    return Array.from(this.errorStats.values());
  }

  /**
   * 获取已禁用的 Extension 列表
   */
  getDisabledExtensions(): string[] {
    return Array.from(this.disabledExtensions);
  }

  /**
   * 清空所有错误统计和禁用列表
   */
  reset(): void {
    this.errorStats.clear();
    this.disabledExtensions.clear();
    log.info('[ErrorBoundary] Reset all error stats');
  }
}

/**
 * 便捷函数：包装异步操作
 */
export async function safeExtensionCall<T>(
  extensionId: string,
  operation: string,
  fn: () => Promise<T>,
  defaultValue?: T
): Promise<T | undefined> {
  return ExtensionErrorBoundary.getInstance().wrapAsync(extensionId, operation, fn, {
    defaultValue,
    disableOnError: true // 默认启用自动禁用
  });
}

/**
 * 便捷函数：包装同步操作
 */
export function safeExtensionCallSync<T>(
  extensionId: string,
  operation: string,
  fn: () => T,
  defaultValue?: T
): T | undefined {
  return ExtensionErrorBoundary.getInstance().wrapSync(extensionId, operation, fn, {
    defaultValue
  });
}
