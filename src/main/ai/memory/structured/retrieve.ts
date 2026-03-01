/**
 * 结构化记忆系统 — Retrieve Pipeline
 *
 * 语义检索：embedding → cosine similarity → Salience 排名 → 格式化注入
 */

import type { MemoryType, StructuredMemoryItem } from './models';
import { decodeEmbedding } from './models';
import type { StructuredMemoryStorage } from './storage';
import type { EmbeddingProvider } from './embedding';
import { cosineTopK, cosineTopKSalience, type VectorSearchResult } from './vector';

// ==================== 类型 ====================

export interface RetrieveInput {
  query: string;
  topK?: number;
  ranking?: 'similarity' | 'salience';
  memoryTypes?: MemoryType[];
  recencyDecayDays?: number;
}

export interface RetrieveResult {
  items: Array<StructuredMemoryItem & { score: number }>;
  context: string;
}

// ==================== Retrieve Pipeline ====================

export class RetrievePipeline {
  constructor(
    private storage: StructuredMemoryStorage,
    private embeddingProvider: EmbeddingProvider
  ) {}

  /**
   * 执行检索：优先语义检索，embedding 不可用时降级到关键词搜索
   */
  async retrieve(input: RetrieveInput): Promise<RetrieveResult> {
    const topK = input.topK ?? 10;
    const ranking = input.ranking ?? 'salience';
    const recencyDecayDays = input.recencyDecayDays ?? 30;

    // 1. 生成 query embedding
    const queryEmbeddings = await this.embeddingProvider.embed([input.query]);
    if (!queryEmbeddings.length || !queryEmbeddings[0].length) {
      return this.fallbackKeywordRetrieve(input.query, topK);
    }
    const queryVec = queryEmbeddings[0];

    // 2. 从 storage 加载所有带 embedding 的 items
    const rawItems = await this.storage.listItemsWithEmbedding(
      input.memoryTypes ? { memoryType: input.memoryTypes[0] } : undefined
    );

    // 如果有多个 type 过滤，做额外过滤
    let filteredItems = rawItems;
    if (input.memoryTypes && input.memoryTypes.length > 1) {
      const typeSet = new Set(input.memoryTypes);
      const allItems = await this.storage.listItems();
      const itemTypeMap = new Map(allItems.map((i) => [i.id, i.memoryType]));
      filteredItems = rawItems.filter((r) => {
        const type = itemTypeMap.get(r.id);
        return type && typeSet.has(type);
      });
    }

    if (filteredItems.length === 0) {
      return { items: [], context: '' };
    }

    // 3. 向量搜索
    let searchResults: VectorSearchResult[];

    if (ranking === 'salience') {
      const corpus = filteredItems.map((r) => ({
        id: r.id,
        embedding: decodeEmbedding(r.embedding) || [],
        reinforcementCount: r.reinforcementCount,
        lastReinforcedAt: r.lastReinforcedAt ? new Date(r.lastReinforcedAt) : null
      }));
      searchResults = cosineTopKSalience(queryVec, corpus, topK, recencyDecayDays);
    } else {
      const corpus = filteredItems.map((r) => ({
        id: r.id,
        embedding: decodeEmbedding(r.embedding) || []
      }));
      searchResults = cosineTopK(queryVec, corpus, topK);
    }

    // 4. 获取完整 item 信息
    const scoredItems: Array<StructuredMemoryItem & { score: number }> = [];
    for (const sr of searchResults) {
      if (sr.score <= 0) continue;
      const item = await this.storage.getItem(sr.id);
      if (item) {
        scoredItems.push({ ...item, score: sr.score });
      }
    }

    // 5. 格式化为注入文本
    const context = this.formatContext(scoredItems);

    return { items: scoredItems, context };
  }

  /**
   * Embedding 不可用时，降级到关键词搜索
   */
  private async fallbackKeywordRetrieve(query: string, topK: number): Promise<RetrieveResult> {
    const keywords = query
      .toLowerCase()
      .split(/[\s,;.!?，。；！？]+/)
      .filter((k) => k.length >= 2);
    if (keywords.length === 0) return { items: [], context: '' };

    const allItems = await this.storage.listItems();
    const scored = allItems
      .map((item) => {
        const lower = item.summary.toLowerCase();
        let hits = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) hits++;
        }
        return { ...item, score: hits / keywords.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const context = this.formatContext(scored);
    return { items: scored, context };
  }

  /**
   * 格式化检索结果为可注入 LLM 的文本
   */
  private formatContext(items: Array<StructuredMemoryItem & { score: number }>): string {
    if (items.length === 0) return '';

    const lines = items.map((item) => {
      const typeLabel = `[${item.memoryType}]`;
      return `- ${typeLabel} ${item.summary}`;
    });

    return [
      '<memory_context>',
      'Relevant context about the user (use only if relevant):',
      ...lines,
      '</memory_context>'
    ].join('\n');
  }
}
