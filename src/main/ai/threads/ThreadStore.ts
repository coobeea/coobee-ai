/**
 * Thread（会话线程）持久化存储
 *
 * 将 ThreadDefinition 存储到 .home/threads/{threadId}.json，
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Thread 独立 JSON 文件
 *   - threadId 使用 Snowflake ID（有序，BigInt 字符串）
 *   - 内存索引（id → ThreadIndexEntry）加速 list 操作
 *   - list 默认按 ID 降序（= 最新在前）
 *   - 单例模式（通过 getInstance）
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import type { ThreadDefinition, ThreadIndexEntry, CreateThreadParams, UpdateThreadParams } from './types';

const log = createLogger('thread-store');

// ==================== ThreadStore ====================

export class ThreadStore {
  private static instance: ThreadStore | null = null;

  private readonly threadsDir: string;

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, ThreadIndexEntry>();

  /** 是否已初始化 */
  private initialized = false;

  constructor(threadsDir: string) {
    this.threadsDir = threadsDir;
  }

  // ==================== 单例 ====================

  static async getInstance(): Promise<ThreadStore> {
    if (!ThreadStore.instance) {
      const { Env } = await import('@main/common/env');
      ThreadStore.instance = new ThreadStore(Env.paths.threadsDir);
    }
    return ThreadStore.instance;
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    ThreadStore.instance = null;
  }

  // ==================== 初始化 ====================

  /** 确保目录存在并加载索引 */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(this.threadsDir)) {
      fs.mkdirSync(this.threadsDir, { recursive: true });
    }

    await this.rebuildIndex();
    this.initialized = true;
    log.info(`[ThreadStore] Initialized: ${this.index.size} threads loaded from ${this.threadsDir}`);
  }

  /** 扫描目录重建索引 */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();
    const files = fs.readdirSync(this.threadsDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(this.threadsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as ThreadDefinition;
        if (def.status !== 'deleted') {
          this.index.set(def.id, toIndexEntry(def));
        }
      } catch (err) {
        log.warn(`[ThreadStore] Failed to load ${file}:`, err);
      }
    }
  }

  // ==================== CRUD ====================

  /** 创建新 Thread（自动生成 Snowflake ID，sessionId = id） */
  async create(params: CreateThreadParams): Promise<ThreadDefinition> {
    await this.init();

    const id = generateSnowflakeId();
    const now = new Date().toISOString();

    const definition: ThreadDefinition = {
      id,
      title: params.title,
      agentId: params.agentId,
      status: 'active',
      sessionId: id,
      agentMode: params.agentMode ?? 'agent',
      agentType: params.agentType ?? 'agent',
      runStatus: 'idle',
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata
    };

    this.writeDefinition(definition);
    this.index.set(definition.id, toIndexEntry(definition));

    log.info(`[ThreadStore] Created thread: ${definition.id} (agent: ${definition.agentId})`);
    return definition;
  }

  /** 获取 Thread 完整定义 */
  async get(threadId: string): Promise<ThreadDefinition | null> {
    await this.init();

    if (!this.index.has(threadId)) return null;

    const filePath = this.getFilePath(threadId);
    if (!fs.existsSync(filePath)) {
      this.index.delete(threadId);
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as ThreadDefinition;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to read thread ${threadId}:`, err);
      return null;
    }
  }

  /**
   * 列出所有 Thread（轻量索引）
   *
   * 默认按 ID 降序（Snowflake ID 天然有序 → 最新在前）。
   * 可选按 agentId 过滤。
   */
  async list(options?: { agentId?: string; status?: string }): Promise<ThreadIndexEntry[]> {
    await this.init();

    let entries = Array.from(this.index.values());

    if (options?.agentId) {
      entries = entries.filter((e) => e.agentId === options.agentId);
    }
    if (options?.status) {
      entries = entries.filter((e) => e.status === options.status);
    }

    // 按 Snowflake ID 降序（最新在前）
    entries.sort((a, b) => {
      if (a.id === b.id) return 0;
      return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
    });

    return entries;
  }

  /** 更新 Thread（部分更新） */
  async update(threadId: string, params: UpdateThreadParams): Promise<ThreadDefinition | null> {
    const existing = await this.get(threadId);
    if (!existing) return null;

    const updated: ThreadDefinition = {
      ...existing,
      ...(params.title !== undefined && { title: params.title }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.runStatus !== undefined && { runStatus: params.runStatus }),
      ...(params.messageCount !== undefined && { messageCount: params.messageCount }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString()
    };

    this.writeDefinition(updated);

    if (updated.status === 'deleted') {
      this.index.delete(threadId);
    } else {
      this.index.set(updated.id, toIndexEntry(updated));
    }

    log.info(`[ThreadStore] Updated thread: ${threadId}`);
    return updated;
  }

  /** 删除 Thread（软删除：标记 status = deleted） */
  async delete(threadId: string): Promise<boolean> {
    await this.init();

    if (!this.index.has(threadId)) return false;

    const filePath = this.getFilePath(threadId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.index.delete(threadId);
      log.info(`[ThreadStore] Deleted thread: ${threadId}`);
      return true;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to delete thread ${threadId}:`, err);
      return false;
    }
  }

  /** 检查 Thread 是否存在 */
  async has(threadId: string): Promise<boolean> {
    await this.init();
    return this.index.has(threadId);
  }

  // ==================== 内部方法 ====================

  private getFilePath(threadId: string): string {
    return path.join(this.threadsDir, `${threadId}.json`);
  }

  private writeDefinition(def: ThreadDefinition): void {
    const filePath = this.getFilePath(def.id);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
  }
}

// ==================== 辅助函数 ====================

/** 从完整定义提取索引条目 */
function toIndexEntry(def: ThreadDefinition): ThreadIndexEntry {
  return {
    id: def.id,
    title: def.title,
    agentId: def.agentId,
    status: def.status,
    runStatus: def.runStatus ?? 'idle',
    agentType: def.agentType ?? 'agent',
    messageCount: def.messageCount,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt
  };
}
