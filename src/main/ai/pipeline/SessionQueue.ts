/**
 * 单 Session 的消息队列管理
 */
import type { PendingMessage, QueueSettings, SessionPipelineState } from './types';
import { DEFAULT_QUEUE_SETTINGS } from './types';

let messageCounter = 0;
let messageCounterMutex = Promise.resolve();

/** 生成唯一消息 ID */
async function generateMessageId(): Promise<string> {
  await messageCounterMutex;
  let release: () => void;
   
  messageCounterMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    if (messageCounter >= Number.MAX_SAFE_INTEGER) {
      messageCounter = 0;
    }
    return `msg-${Date.now()}-${++messageCounter}`;
  } finally {
    release!();
  }
}

export class SessionQueue {
  private state: SessionPipelineState;
  /** 最后访问时间（用于 TTL 清理） */
  public lastAccessTime: number;

  constructor(sessionId: string, settings?: Partial<QueueSettings>) {
    this.state = {
      sessionId,
      settings: { ...DEFAULT_QUEUE_SETTINGS, ...settings },
      queue: [],
      isRunning: false,
      draining: false,
      droppedCount: 0,
      summaryLines: []
    };
    this.lastAccessTime = Date.now();
  }

  /** 获取队列设置 */
  get settings(): QueueSettings {
    return this.state.settings;
  }

  /** 设置队列模式 */
  setSettings(settings: Partial<QueueSettings>): void {
    this.state.settings = { ...this.state.settings, ...settings };
  }

  /** 是否正在执行 */
  get isRunning(): boolean {
    return this.state.isRunning;
  }

  set isRunning(val: boolean) {
    this.state.isRunning = val;
    this.lastAccessTime = Date.now();
  }

  /** 是否正在 drain */
  get draining(): boolean {
    return this.state.draining;
  }

  set draining(val: boolean) {
    this.state.draining = val;
  }

  /** 队列长度 */
  get length(): number {
    return this.state.queue.length;
  }

  /** 已丢弃的消息数 */
  get droppedCount(): number {
    return this.state.droppedCount;
  }

  /** 入队 */
  async enqueue(sessionId: string, message: string, metadata?: Record<string, unknown>): Promise<PendingMessage> {
    this.lastAccessTime = Date.now();

    const id = await generateMessageId();
    const pending: PendingMessage = {
      id,
      sessionId,
      message,
      enqueuedAt: Date.now(),
      metadata
    };

    // 容量检查
    if (this.state.queue.length >= this.state.settings.cap) {
      this.applyDropPolicy(pending);
      return pending;
    }

    this.state.queue.push(pending);
    return pending;
  }

  /** 出队（FIFO） */
  dequeue(): PendingMessage | undefined {
    return this.state.queue.shift();
  }

  /** 取出所有待处理消息（collect 模式用） */
  dequeueAll(): PendingMessage[] {
    const all = [...this.state.queue];
    this.state.queue = [];
    return all;
  }

  /** 查看队首 */
  peek(): PendingMessage | undefined {
    return this.state.queue[0];
  }

  /** 队列是否为空 */
  isEmpty(): boolean {
    return this.state.queue.length === 0;
  }

  /** 清空队列 */
  clear(): number {
    const count = this.state.queue.length;
    this.state.queue = [];
    return count;
  }

  /** 获取完整状态 */
  getState(): SessionPipelineState {
    return { ...this.state };
  }

  // ─── 私有方法 ─────────────────────────────────────

  private applyDropPolicy(newMsg: PendingMessage): void {
    const policy = this.state.settings.dropPolicy;

    switch (policy) {
      case 'old':
        // 丢弃最老的
        this.state.queue.shift();
        this.state.queue.push(newMsg);
        this.state.droppedCount++;
        break;
      case 'new':
        // 丢弃新消息
        this.state.droppedCount++;
        break;
      case 'summarize':
        // 将最老消息的内容存入摘要，然后替换
        {
          const oldest = this.state.queue.shift();
          if (oldest) {
            this.state.summaryLines.push(oldest.message);
          }
          this.state.queue.push(newMsg);
          this.state.droppedCount++;
        }
        break;
    }
  }
}
