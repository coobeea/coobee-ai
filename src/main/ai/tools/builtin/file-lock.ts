/**
 * 文件级互斥锁
 *
 * 防止多个 Agent 同时写入同一文件导致竞态。
 * 使用简单的内存锁（单进程场景），基于 Promise 链实现 FIFO 排队。
 *
 * 如果 Agent A 正在写文件 X，Agent B 写文件 X 的请求会排队等待。
 * 不同文件的操作互不阻塞。
 */

const fileLocks = new Map<string, Promise<void>>();

/**
 * 获取文件锁，执行操作后自动释放
 *
 * @param filePath - 要锁定的文件路径（绝对路径）
 * @param fn - 需要在锁保护下执行的操作
 * @returns 操作的返回值
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // 等待当前锁释放
  const existing = fileLocks.get(filePath) || Promise.resolve();

  let releaseLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  fileLocks.set(filePath, newLock);

  try {
    await existing;
    return await fn();
  } finally {
    releaseLock!();
    // 如果当前锁就是最新的，清理 Map
    if (fileLocks.get(filePath) === newLock) {
      fileLocks.delete(filePath);
    }
  }
}
