/**
 * CompressionService - 对话压缩服务
 *
 * 职责：
 * - 管理 SessionCompressor 实例
 * - 检查是否需要压缩
 * - 执行压缩并返回结果
 * - 生成压缩相关的 StreamChunk
 */

import { createLogger } from '@main/common/logger';
import { SessionCompressor } from '../openai/SessionCompressor';

const log = createLogger('CompressionService');
import type { FileSession } from '../openai/FileSession';
import type { CompressionResult } from '../openai/types';
import type { StreamChunk } from '../types';

/** 压缩配置 */
export interface CompressionConfig {
  enabled: boolean;
  minMessageCount?: number;
  contextWindowSize?: number;
  maxSummaryCount?: number;
  summaryModel?: string;
  debug?: boolean;
}

/** 压缩状态 */
export interface CompressionStatus {
  needsCompression: boolean;
  totalTokens: number;
  threshold: number;
  messageCount: number;
}

/**
 * 对话压缩服务
 */
export class CompressionService {
  private compressor: SessionCompressor | null = null;

  constructor(config?: CompressionConfig) {
    if (config?.enabled) {
      this.compressor = new SessionCompressor(config);
    }
  }

  /**
   * 检查是否需要压缩
   */
  async getCompressionStatus(session: FileSession): Promise<CompressionStatus | null> {
    if (!this.compressor) return null;

    const status = await this.compressor.getCompressionStatus(session);
    if (!status) return null;

    return {
      needsCompression: status.totalTokens >= status.threshold,
      totalTokens: status.totalTokens,
      threshold: status.threshold,
      messageCount: 0 // FileSession 不直接暴露此信息，需要调用 getItemCount()
    };
  }

  /**
   * 执行压缩并返回 StreamChunk
   */
  async compressWithChunks(
    session: FileSession,
    model: string,
    beforeCompressionHook?: (status: CompressionStatus) => Promise<{
      skipDefault?: boolean;
      customSummary?: string;
    }>
  ): Promise<StreamChunk[]> {
    if (!this.compressor) return [];

    const chunks: StreamChunk[] = [];

    try {
      const status = await this.getCompressionStatus(session);
      if (!status || !status.needsCompression) return [];

      // 调用 Hook（如果有）
      let skipDefault = false;
      if (beforeCompressionHook) {
        const hookResult = await beforeCompressionHook(status);
        skipDefault = hookResult.skipDefault || false;
      }

      if (skipDefault) return [];

      // 执行压缩
      const result = await this.compressor.compressIfNeeded(session, model);

      if (result.compressed) {
        chunks.push({
          type: 'compression:done',
          content: `Compressed ${result.summarizedCount || 0} messages`,
          data: {
            summarizedSeqs: result.summarizedSeqs || [],
            endSeq: result.endSeq || 0,
            originalTokens: result.originalTokens || 0,
            summaryTokens: result.summaryTokens || 0,
            compressionRatio: result.compressionRatio || 0,
            duration: result.duration || 0
          }
        });
      }

      return chunks;
    } catch (error) {
      log.error('压缩失败:', error);
      return [];
    }
  }

  /**
   * 强制压缩
   */
  async forceCompress(session: FileSession, model: string): Promise<CompressionResult> {
    const forceCompressor = new SessionCompressor({
      enabled: true,
      minMessageCount: 2,
      contextWindowSize: 1,
      thresholdRatio: 0,
      keepRatio: 0.3
    });

    return forceCompressor.compressIfNeeded(session, model);
  }

  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.compressor !== null;
  }
}
