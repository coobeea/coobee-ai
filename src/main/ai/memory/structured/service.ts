/**
 * StructuredMemoryService — 结构化记忆系统的单例入口
 *
 * 封装 Storage + MemorizePipeline + RetrievePipeline + EmbeddingProvider，
 * 为 memory tool、memory-auto extension 和其他模块提供统一的高层 API。
 *
 * 使用方式：
 *   const svc = StructuredMemoryService.getInstance();
 *   await svc.initialize();
 *   const result = await svc.memorize({ content, source });
 *   const ctx = await svc.retrieve({ query });
 */

import { log } from '@main/common/logger';
import { StructuredMemoryStorage } from './storage';
import { MemorizePipeline } from './memorize';
import { RetrievePipeline } from './retrieve';
import { OpenAIEmbeddingProvider, NoopEmbeddingProvider } from './embedding';
import type { EmbeddingProvider } from './embedding';
import type { LLMChatFn } from '../../quality-loop/llm-chat';
import type { MemorizeResult } from './memorize';
import type { RetrieveResult } from './retrieve';
import type { MemoryType, StructuredMemoryItem } from './models';
import type { MigrationResult, MigrationOptions } from './migration';

export interface StructuredMemoryServiceOptions {
  llmChat?: LLMChatFn;
  embeddingApiKey?: string;
  embeddingModel?: string;
}

export class StructuredMemoryService {
  private static instance: StructuredMemoryService | null = null;

  private storage: StructuredMemoryStorage | null = null;
  private memorize: MemorizePipeline | null = null;
  private retrievePipeline: RetrievePipeline | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private _initialized = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): StructuredMemoryService {
    if (!StructuredMemoryService.instance) {
      StructuredMemoryService.instance = new StructuredMemoryService();
    }
    return StructuredMemoryService.instance;
  }

  static destroyInstance(): void {
    if (StructuredMemoryService.instance) {
      StructuredMemoryService.instance.close();
      StructuredMemoryService.instance = null;
    }
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * 初始化结构化记忆服务
   *
   * 使用已有的 SQLiteService 单例获取数据库连接，
   * 并根据是否提供 llmChat 函数和 API key 来决定功能范围。
   */
  async initialize(options: StructuredMemoryServiceOptions = {}): Promise<void> {
    if (this._initialized) return;

    try {
      const { SQLiteService } = await import('@main/common/database');
      const sqliteService = SQLiteService.getInstance();
      const conn = await sqliteService.getConnectionForMemory();

      this.storage = new StructuredMemoryStorage(conn);
      await this.storage.initialize();

      // Embedding provider: 有 API key 时用 OpenAI，否则 Noop
      if (options.embeddingApiKey) {
        this.embeddingProvider = new OpenAIEmbeddingProvider({
          apiKey: options.embeddingApiKey,
          model: options.embeddingModel
        });
      } else {
        this.embeddingProvider = new NoopEmbeddingProvider();
        log.info('[StructuredMemory] No embedding API key, using NoopEmbeddingProvider');
      }

      // Memorize pipeline: 需要 LLM 对话函数
      if (options.llmChat) {
        this.memorize = new MemorizePipeline(this.storage, options.llmChat);
      }

      // Retrieve pipeline: 需要 embedding provider
      this.retrievePipeline = new RetrievePipeline(this.storage, this.embeddingProvider);

      this._initialized = true;
      log.info('[StructuredMemory] Service initialized successfully');
    } catch (err) {
      log.error('[StructuredMemory] Initialization failed:', err);
      throw err;
    }
  }

  /**
   * 存储记忆（经过 LLM 提取管线）
   */
  async memorizeContent(input: { content: string; source?: string; userId?: string }): Promise<MemorizeResult | null> {
    if (!this.memorize || !this.storage) {
      log.warn('[StructuredMemory] Memorize not available (llmChat not configured)');
      return null;
    }

    return this.memorize.memorize({
      content: input.content,
      resourceUrl: input.source
    });
  }

  /**
   * 语义检索记忆
   */
  async retrieve(input: {
    query: string;
    topK?: number;
    mode?: 'similarity' | 'salience';
    userId?: string;
  }): Promise<RetrieveResult> {
    if (!this.retrievePipeline) {
      return { items: [], context: '' };
    }

    return this.retrievePipeline.retrieve({
      query: input.query,
      topK: input.topK ?? 5,
      ranking: input.mode ?? 'salience'
    });
  }

  /**
   * 直接写入一条记忆（跳过 LLM 提取，用于迁移或手动写入）
   */
  async writeItem(input: {
    summary: string;
    memoryType: MemoryType;
    source?: string;
  }): Promise<StructuredMemoryItem | null> {
    if (!this.storage) return null;

    const { computeContentHash, nowISO } = await import('./models');
    const hash = computeContentHash(input.summary, input.memoryType);

    const existing = await this.storage.findItemByHash(hash);
    if (existing) {
      await this.storage.reinforceItem(existing.id);
      return existing;
    }

    return this.storage.createItem({
      memoryType: input.memoryType,
      summary: input.summary,
      contentHash: hash,
      reinforcementCount: 1,
      lastReinforcedAt: nowISO()
    });
  }

  /**
   * 获取记忆统计
   */
  async getStats(): Promise<{
    totalItems: number;
    totalCategories: number;
    byType: Record<string, number>;
  } | null> {
    if (!this.storage) return null;
    return this.storage.getStats();
  }

  /**
   * 列出所有记忆条目
   */
  async listItems(filter?: { memoryType?: MemoryType; limit?: number }): Promise<StructuredMemoryItem[]> {
    if (!this.storage) return [];
    return this.storage.listItems(filter);
  }

  /**
   * 搜索记忆（关键词搜索，作为语义搜索的降级方案）
   */
  async searchByKeyword(query: string, limit = 10): Promise<StructuredMemoryItem[]> {
    if (!this.storage) return [];

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 0);
    if (keywords.length === 0) return [];

    const allItems = await this.storage.listItems();
    const scored = allItems
      .map((item) => {
        const lower = item.summary.toLowerCase();
        let hits = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) hits++;
        }
        return { item, score: hits / keywords.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.item);
  }

  /**
   * 迁移 Markdown 记忆到结构化存储
   */
  async migrateFromMarkdown(workspacePath: string, options?: MigrationOptions): Promise<MigrationResult | null> {
    if (!this.storage) return null;

    const { migrateFromMarkdown } = await import('./migration');
    return migrateFromMarkdown(workspacePath, this.storage, options);
  }

  /**
   * 导出结构化记忆到 Markdown
   */
  async exportToMarkdown(outputDir: string): Promise<string[]> {
    if (!this.storage) return [];

    const { exportToMarkdown } = await import('./migration');
    return exportToMarkdown(this.storage, outputDir);
  }

  /**
   * 获取底层 storage（仅供高级用例）
   */
  getStorage(): StructuredMemoryStorage | null {
    return this.storage;
  }

  private close(): void {
    if (this.storage) {
      this.storage.close();
      this.storage = null;
    }
    this.memorize = null;
    this.retrievePipeline = null;
    this.embeddingProvider = null;
    this._initialized = false;
    log.info('[StructuredMemory] Service closed');
  }
}
