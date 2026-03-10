/**
 * ChunkQueue — 推送→拉取桥接器
 *
 * 将回调式推送（push）转换为 AsyncIterator 拉取（for await...of）。
 * 用于 PiMono SDK 等仅提供回调 API（subscribe(callback)）的场景。
 *
 * 用法：
 *   const queue = new ChunkQueue<StreamChunk>()
 *   // 推送端
 *   sdk.subscribe(event => queue.push(event))
 *   sdk.run().finally(() => queue.end())
 *   // 消费端
 *   for await (const chunk of queue) { yield chunk }
 */
export class ChunkQueue<T> implements AsyncIterableIterator<T> {
  private queue: T[] = [];
  private resolve: ((value: IteratorResult<T>) => void) | null = null;
  private done = false;
  private error: Error | null = null;

  /** 推入一个元素 */
  push(item: T): void {
    if (this.done) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  /** 标记流结束 */
  end(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as T, done: true });
    }
  }

  /** 标记流出错 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throw(err?: any): Promise<IteratorResult<T>> {
    this.error = err instanceof Error ? err : new Error(String(err));
    this.end();
    return Promise.reject(this.error);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.done) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolve = resolve;
    });
  }
}
