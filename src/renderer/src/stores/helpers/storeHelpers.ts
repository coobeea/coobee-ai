/**
 * Pinia Store 辅助工具和规范
 *
 * 提供统一的错误处理、Loading 状态、异步操作封装等功能。
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';

/**
 * Store 错误状态
 */
export interface StoreError {
  code: string;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

/**
 * Store Loading 状态
 */
export interface LoadingState {
  /** 是否正在加载 */
  isLoading: boolean;
  /** 加载操作名称 */
  operation?: string;
  /** 开始时间 */
  startTime?: number;
}

/**
 * 创建统一的错误状态管理
 */
export function useStoreError(): {
  error: Ref<StoreError | null>;
  hasError: ComputedRef<boolean>;
  setError: (code: string, message: string, context?: Record<string, unknown>) => void;
  clearError: () => void;
  setErrorFromException: (err: unknown, defaultMessage?: string) => void;
} {
  const error = ref<StoreError | null>(null);
  const hasError = computed(() => error.value !== null);

  function setError(code: string, message: string, context?: Record<string, unknown>): void {
    error.value = {
      code,
      message,
      timestamp: Date.now(),
      context
    };
  }

  function clearError(): void {
    error.value = null;
  }

  /**
   * 从 Error 对象设置错误
   */
  function setErrorFromException(err: unknown, defaultMessage = 'Unknown error'): void {
    if (err instanceof Error) {
      setError('EXCEPTION', err.message, { stack: err.stack });
    } else {
      setError('UNKNOWN', String(err) || defaultMessage);
    }
  }

  return {
    error,
    hasError,
    setError,
    clearError,
    setErrorFromException
  };
}

/**
 * 创建统一的 Loading 状态管理
 */
export function useStoreLoading(): {
  isLoading: ComputedRef<boolean>;
  loadingStates: Ref<Map<string, LoadingState>>;
  startLoading: (operation: string) => void;
  stopLoading: (operation: string) => void;
  isOperationLoading: (operation: string) => boolean;
  clearAllLoading: () => void;
} {
  const loadingStates = ref<Map<string, LoadingState>>(new Map());

  const isLoading = computed(() => {
    return Array.from(loadingStates.value.values()).some((state) => state.isLoading);
  });

  function startLoading(operation: string): void {
    loadingStates.value.set(operation, {
      isLoading: true,
      operation,
      startTime: Date.now()
    });
  }

  function stopLoading(operation: string): void {
    const state = loadingStates.value.get(operation);
    if (state) {
      const duration = state.startTime ? Date.now() - state.startTime : 0;
      console.debug(`[Store] ${operation} completed in ${duration}ms`);
      loadingStates.value.delete(operation);
    }
  }

  function isOperationLoading(operation: string): boolean {
    return loadingStates.value.get(operation)?.isLoading ?? false;
  }

  function clearAllLoading(): void {
    loadingStates.value.clear();
  }

  return {
    isLoading,
    loadingStates,
    startLoading,
    stopLoading,
    isOperationLoading,
    clearAllLoading
  };
}

/**
 * 异步操作包装器
 *
 * 统一处理 loading、错误、异常
 */
export async function withAsyncHandler<T>(
  operation: string,
  fn: () => Promise<T>,
  options: {
    loading?: ReturnType<typeof useStoreLoading>;
    error?: ReturnType<typeof useStoreError>;
    silent?: boolean; // 静默模式，不抛出异常
    onSuccess?: (result: T) => void;
    onError?: (err: unknown) => void;
  }
): Promise<T | null> {
  const { loading, error, silent = false, onSuccess, onError } = options;

  try {
    // 开始 loading
    loading?.startLoading(operation);
    error?.clearError();

    // 执行操作
    const result = await fn();

    // 成功回调
    onSuccess?.(result);

    return result;
  } catch (err) {
    // 记录错误
    error?.setErrorFromException(err, `${operation} failed`);

    // 错误回调
    onError?.(err);

    // 静默模式返回 null，否则抛出
    if (!silent) {
      throw err;
    }

    return null;
  } finally {
    // 停止 loading
    loading?.stopLoading(operation);
  }
}

/**
 * Store 通用配置
 */
export interface StoreConfig {
  /** Store 名称（用于日志和调试） */
  name: string;
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 默认错误消息 */
  defaultErrorMessage?: string;
}

/**
 * 创建规范化的 Store 基础功能
 */
export function createStoreBase(config: StoreConfig): ReturnType<typeof useStoreLoading> &
  ReturnType<typeof useStoreError> & {
    execute: <T>(operation: string, fn: () => Promise<T>, silent?: boolean) => Promise<T | null>;
    reset: () => void;
  } {
  const { name, debug = false } = config;

  const loading = useStoreLoading();
  const error = useStoreError();

  /**
   * 执行异步操作（标准封装）
   */
  async function execute<T>(operation: string, fn: () => Promise<T>, silent = false): Promise<T | null> {
    if (debug) {
      console.log(`[${name}] Executing: ${operation}`);
    }

    return withAsyncHandler(operation, fn, {
      loading,
      error,
      silent,
      onSuccess: (result) => {
        if (debug) {
          console.log(`[${name}] ${operation} succeeded:`, result);
        }
      },
      onError: (err) => {
        console.error(`[${name}] ${operation} failed:`, err);
      }
    });
  }

  /**
   * 重置所有状态
   */
  function reset(): void {
    error.clearError();
    loading.clearAllLoading();
  }

  return {
    // 状态
    ...loading,
    ...error,

    // 方法
    execute,
    reset
  };
}

/**
 * 防抖异步操作
 */
export function debounceAsync<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  return async (...args: Parameters<T>): Promise<void> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return new Promise((resolve) => {
      timeoutId = setTimeout(async () => {
        await fn(...args);
        resolve();
      }, delay);
    });
  };
}

/**
 * 节流异步操作
 */
export function throttleAsync<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<void> {
  let lastCall = 0;
  let pending: Promise<void> | null = null;

  return async (...args: Parameters<T>): Promise<void> => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      await fn(...args);
    } else if (!pending) {
      pending = new Promise((resolve) => {
        setTimeout(async () => {
          lastCall = Date.now();
          await fn(...args);
          pending = null;
          resolve();
        }, delay - timeSinceLastCall);
      });
      return pending;
    }
  };
}

/**
 * 创建可取消的异步操作
 */
export function createCancellableOperation<T>(): {
  execute: (fn: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  cancel: () => void;
} {
  let abortController: AbortController | null = null;

  async function execute(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // 取消之前的操作
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const result = await fn(signal);
      return result;
    } finally {
      abortController = null;
    }
  }

  function cancel(): void {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  return {
    execute,
    cancel
  };
}
