/**
 * DiscussionStore - 讨论持久化存储
 *
 * 将讨论会话保存到文件系统
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { DiscussionSession } from './types';

const log = createLogger('discussion-store');

export class DiscussionStore {
  private storePath!: string;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    const { Env } = await import('@main/common/env');
    this.storePath = path.join(Env.paths.userHome, 'discussions');
    await fs.promises.mkdir(this.storePath, { recursive: true });
  }

  /**
   * 保存讨论会话
   */
  async save(session: DiscussionSession): Promise<void> {
    if (!this.storePath) {
      await this.initialize();
    }

    const filePath = path.join(this.storePath, `${session.id}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
    log.debug(`[DiscussionStore] Session saved: ${session.id}`);
  }

  /**
   * 加载讨论会话
   */
  async load(id: string): Promise<DiscussionSession | null> {
    if (!this.storePath) {
      await this.initialize();
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
   * 列出所有讨论
   */
  async list(): Promise<DiscussionSession[]> {
    if (!this.storePath) {
      await this.initialize();
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
      await this.initialize();
    }

    const filePath = path.join(this.storePath, `${id}.json`);
    await fs.promises.unlink(filePath);
    log.info(`[DiscussionStore] Session deleted: ${id}`);
  }
}
