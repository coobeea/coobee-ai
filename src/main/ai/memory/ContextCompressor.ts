/**
 * ContextCompressor - 上下文压缩器
 *
 * 压缩长对话历史以节省 token
 */

import { createLogger } from '@main/common/logger';
import type { CompressionResult, CompressionStrategy } from './types';

const log = createLogger('context-compressor');

export class ContextCompressor {
  /**
   * 压缩上下文
   */
  async compress(content: string, strategy: CompressionStrategy = 'summary'): Promise<CompressionResult> {
    log.info(`[ContextCompressor] Compressing content using ${strategy} strategy`);

    const originalTokens = this.estimateTokens(content);

    let compressedContent: string;

    switch (strategy) {
      case 'summary':
        compressedContent = await this.summarize(content);
        break;

      case 'embedding':
        compressedContent = await this.embedAndRetrieve(content);
        break;

      case 'hybrid':
        compressedContent = await this.hybridCompress(content);
        break;

      default:
        compressedContent = content;
    }

    const compressedTokens = this.estimateTokens(compressedContent);
    const compressionRatio = compressedTokens / originalTokens;

    log.info(
      `[ContextCompressor] Compressed ${originalTokens} -> ${compressedTokens} tokens (${(compressionRatio * 100).toFixed(1)}%)`
    );

    return {
      originalTokens,
      compressedTokens,
      compressionRatio,
      compressedContent,
      strategy
    };
  }

  /**
   * 摘要压缩
   */
  private async summarize(content: string): Promise<string> {
    const paragraphs = content.split('\n\n').filter(Boolean);

    if (paragraphs.length <= 3) {
      return content;
    }

    const keyParagraphs = paragraphs.filter((p, i) => {
      return i === 0 || i === paragraphs.length - 1 || p.length > 100;
    });

    return keyParagraphs.join('\n\n') + '\n\n[...省略部分内容...]';
  }

  /**
   * 基于向量的压缩
   */
  private async embedAndRetrieve(content: string): Promise<string> {
    const sentences = content.split(/[.!?]+/).filter(Boolean);

    const importantSentences = sentences.filter((s) => {
      return s.length > 20 && (s.includes('重要') || s.includes('关键') || s.includes('注意'));
    });

    if (importantSentences.length === 0) {
      return sentences.slice(0, Math.ceil(sentences.length / 2)).join('. ') + '.';
    }

    return importantSentences.join('. ') + '.';
  }

  /**
   * 混合压缩
   */
  private async hybridCompress(content: string): Promise<string> {
    const summary = await this.summarize(content);
    const embedded = await this.embedAndRetrieve(content);

    return `${summary}\n\n## 关键信息\n\n${embedded}`;
  }

  /**
   * 估算 token 数
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
