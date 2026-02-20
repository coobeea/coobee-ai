/**
 * 简单的异步锁实现，用于控制并发访问
 */
export class AsyncLock {
  private promise: Promise<void> | null = null;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prevPromise = this.promise;
    let resolveNext: () => void;
    this.promise = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    try {
      if (prevPromise) {
        await prevPromise;
      }
      return await fn();
    } finally {
      resolveNext!();
    }
  }
}
