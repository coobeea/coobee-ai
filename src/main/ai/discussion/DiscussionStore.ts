/**
 * DiscussionStore - 讨论持久化存储
 *
 * 将讨论会话保存到文件系统
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscussionSession, DiscussionMessage } from './types';

export class DiscussionStore {
  private static instance: DiscussionStore;
  private storePath!: string;
  private initialized = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  /**
   * 获取单例实例
   *
   * @param storePath - 存储路径（首次调用时必须提供）
   */
  public static async getInstance(storePath?: string): Promise<DiscussionStore> {
    if (!DiscussionStore.instance) {
      if (!storePath) {
        throw new Error('DiscussionStore: storePath is required for first initialization');
      }
      DiscussionStore.instance = new DiscussionStore();
      await DiscussionStore.instance.initialize(storePath);
    }
    return DiscussionStore.instance;
  }

  private async initialize(storePath: string): Promise<void> {
    if (this.initialized) return;

    this.storePath = storePath;
    await fs.promises.mkdir(this.storePath, { recursive: true });
    this.initialized = true;
  }

  /**
   * 保存讨论会话
   */
  async save(session: DiscussionSession): Promise<void> {
    if (!this.storePath) {
      throw new Error('DiscussionStore: not initialized, call getInstance(storePath) first');
    }

    const filePath = path.join(this.storePath, `${session.id}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * 加载讨论会话
   */
  async load(id: string): Promise<DiscussionSession | null> {
    if (!this.storePath) {
      throw new Error('DiscussionStore: not initialized, call getInstance(storePath) first');
    }

    const filePath = path.join(this.storePath, `${id}.json`);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as DiscussionSession;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * 获取讨论会话（load 的别名）
   */
  async get(id: string): Promise<DiscussionSession | null> {
    return this.load(id);
  }

  /**
   * 创建讨论会话
   */
  async create(session: Omit<DiscussionSession, 'id'> & { id?: string }): Promise<DiscussionSession> {
    const fullSession: DiscussionSession = {
      id: session.id || `discussion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...session
    } as DiscussionSession;

    await this.save(fullSession);
    return fullSession;
  }

  /**
   * 更新讨论会话
   */
  async update(id: string, updates: Partial<DiscussionSession>): Promise<void> {
    const session = await this.load(id);
    if (!session) {
      throw new Error(`Discussion session ${id} not found`);
    }

    Object.assign(session, updates);
    session.updatedAt = Date.now();
    await this.save(session);
  }

  /**
   * 添加消息到讨论室
   */
  async addMessage(
    id: string,
    message: {
      participant: string;
      content: string;
      timestamp: number;
      type?: DiscussionMessage['type'];
    }
  ): Promise<void> {
    const session = await this.load(id);
    if (!session) {
      throw new Error(`Discussion session ${id} not found`);
    }

    const fullMessage: DiscussionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: message.participant,
      content: message.content,
      timestamp: message.timestamp,
      type: message.type || 'statement'
    };

    session.messages.push(fullMessage);
    session.updatedAt = Date.now();
    await this.save(session);
  }

  /**
   * 列出所有讨论
   */
  async list(): Promise<DiscussionSession[]> {
    if (!this.storePath) {
      throw new Error('DiscussionStore: not initialized, call getInstance(storePath) first');
    }

    const files = await fs.promises.readdir(this.storePath);
    const sessions: DiscussionSession[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const session = await this.load(id);
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 删除讨论
   */
  async delete(id: string): Promise<void> {
    if (!this.storePath) {
      throw new Error('DiscussionStore: not initialized, call getInstance(storePath) first');
    }

    const filePath = path.join(this.storePath, `${id}.json`);
    await fs.promises.unlink(filePath);
  }
}
