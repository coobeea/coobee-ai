/**
 * 结构化记忆系统 — Embedding 生成
 *
 * 提供 EmbeddingProvider 接口和 OpenAI embedding 实现。
 * 支持批量生成和缓存。
 */

import OpenAI from 'openai';

// ==================== 接口 ====================

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
}

// ==================== OpenAI Embedding ====================

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  readonly dimension: number;

  constructor(options: OpenAIEmbeddingOptions = {}) {
    this.model = options.model || 'text-embedding-3-small';
    this.dimension = this.model.includes('3-small') ? 1536 : 3072;
    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      baseURL: options.baseURL
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts
    });

    return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

// ==================== Noop Embedding (for testing/offline) ====================

/**
 * 占位 Embedding Provider，不实际生成向量。
 * 用于离线模式或不需要语义检索的场景。
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 0;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}
