/**
 * KnowledgeAdapter - 知识适配器
 *
 * 将知识包适配到目标项目
 */

import { createLogger } from '@main/common/logger';
import type { KnowledgePackage, KnowledgeItem, AdaptationConfig } from './types';

const log = createLogger('knowledge-adapter');

interface AdaptationResult {
  applicable: KnowledgeItem[];
  modified: Array<{ original: KnowledgeItem; adapted: KnowledgeItem }>;
  skipped: Array<{ item: KnowledgeItem; reason: string }>;
}

export class KnowledgeAdapter {
  /**
   * 适配知识包到目标项目
   */
  async adaptToProject(
    pkg: KnowledgePackage,
    targetProject: string,
    config: AdaptationConfig
  ): Promise<AdaptationResult> {
    log.info(`[KnowledgeAdapter] Adapting package "${pkg.name}" to ${targetProject}`);

    const result: AdaptationResult = {
      applicable: [],
      modified: [],
      skipped: []
    };

    for (const item of pkg.items) {
      const similarity = await this.calculateSimilarity(item, targetProject, config.similarityMethod);

      if (similarity >= config.autoAdaptThreshold) {
        result.applicable.push(item);
      } else if (similarity >= config.autoAdaptThreshold * 0.6) {
        const adapted = await this.adaptItem(item, targetProject);
        result.modified.push({ original: item, adapted });
      } else {
        result.skipped.push({
          item,
          reason: `相似度过低 (${(similarity * 100).toFixed(1)}%)`
        });
      }
    }

    log.info(
      `[KnowledgeAdapter] Adapted: ${result.applicable.length} direct, ${result.modified.length} modified, ${result.skipped.length} skipped`
    );

    return result;
  }

  /**
   * 计算相似度
   */
  private async calculateSimilarity(
    item: KnowledgeItem,
    _targetProject: string,
    method: AdaptationConfig['similarityMethod']
  ): Promise<number> {
    if (method === 'keyword') {
      return this.keywordSimilarity(item);
    } else if (method === 'semantic') {
      return this.semanticSimilarity(item);
    } else {
      return (this.keywordSimilarity(item) + this.semanticSimilarity(item)) / 2;
    }
  }

  /**
   * 关键词相似度
   */
  private keywordSimilarity(item: KnowledgeItem): number {
    const hasTypeScript = item.techStack?.includes('TypeScript') || item.content.includes('TypeScript');
    const hasNodeJS = item.techStack?.includes('Node.js') || item.content.includes('Node.js');

    if (hasTypeScript && hasNodeJS) return 0.9;
    if (hasTypeScript || hasNodeJS) return 0.7;

    return 0.5;
  }

  /**
   * 语义相似度
   */
  private semanticSimilarity(_item: KnowledgeItem): number {
    return 0.75;
  }

  /**
   * 适配知识项
   */
  private async adaptItem(item: KnowledgeItem, _targetProject: string): Promise<KnowledgeItem> {
    return {
      ...item,
      id: `adapted-${item.id}`,
      content: `[已适配] ${item.content}`,
      confidence: item.confidence * 0.8
    };
  }
}
