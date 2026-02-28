/**
 * 结构化记忆系统 — Memorize Pipeline
 *
 * 输入对话文本 → LLM 按类型提取 → 去重 → 持久化
 * 替代原有 regex 信号词检测。
 */

import type { LLMChatFn, ChatMessage } from '@main/ai/quality-loop/llm-chat';
import type { StructuredMemoryItem, MemoryResource, MemoryType } from './models';
import { computeContentHash, nowISO, DEFAULT_CATEGORIES } from './models';
import type { StructuredMemoryStorage } from './storage';
import {
  ENABLED_MEMORY_TYPES,
  buildExtractionPrompt,
  formatCategoriesForPrompt,
  parseExtractionResponse,
  type ExtractedMemory
} from './prompts';

// ==================== 类型 ====================

export interface MemorizeInput {
  content: string;
  modality?: 'conversation' | 'text';
  sessionId?: string;
  resourceUrl?: string;
}

export interface MemorizeResult {
  items: StructuredMemoryItem[];
  reinforced: Array<{ id: string; newCount: number }>;
  resource: MemoryResource | null;
  errors: string[];
}

export interface MemorizeOptions {
  enabledTypes?: MemoryType[];
  temperature?: number;
  maxTokens?: number;
}

// ==================== Memorize Pipeline ====================

export class MemorizePipeline {
  private categoriesPrompt: string;

  constructor(
    private storage: StructuredMemoryStorage,
    private llmChat: LLMChatFn,
    private options: MemorizeOptions = {}
  ) {
    this.categoriesPrompt = formatCategoriesForPrompt(
      DEFAULT_CATEGORIES.map((c) => ({ name: c.name, description: c.description }))
    );
  }

  /**
   * 执行记忆写入管线
   */
  async memorize(input: MemorizeInput): Promise<MemorizeResult> {
    const errors: string[] = [];
    const allItems: StructuredMemoryItem[] = [];
    const reinforced: Array<{ id: string; newCount: number }> = [];

    // 1. 创建 Resource 记录
    let resource: MemoryResource | null = null;
    try {
      resource = await this.storage.createResource({
        url: input.resourceUrl || `session://${input.sessionId || 'unknown'}`,
        modality: input.modality || 'conversation',
        content: input.content.slice(0, 2000)
      });
    } catch (err) {
      errors.push(`Resource creation failed: ${err}`);
    }

    // 2. 确保默认分类存在
    await this.ensureCategories();

    // 3. 对每种启用的类型，调用 LLM 提取
    const types = this.options.enabledTypes || ENABLED_MEMORY_TYPES;
    for (const memoryType of types) {
      try {
        const extracted = await this.extractByType(memoryType, input.content);
        for (const mem of extracted) {
          const result = await this.dedupeAndPersist(mem, memoryType, resource?.id ?? null);
          if (result.type === 'new') {
            allItems.push(result.item);
          } else if (result.type === 'reinforced') {
            reinforced.push({ id: result.id, newCount: result.newCount });
          }
        }
      } catch (err) {
        errors.push(`Extraction failed for type '${memoryType}': ${err}`);
      }
    }

    return { items: allItems, reinforced, resource, errors };
  }

  /**
   * 调用 LLM 提取指定类型的记忆
   */
  private async extractByType(memoryType: MemoryType, content: string): Promise<ExtractedMemory[]> {
    const prompt = buildExtractionPrompt(memoryType, content, this.categoriesPrompt);
    if (!prompt) return [];

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

    const output = await this.llmChat({
      messages,
      temperature: this.options.temperature ?? 0.3,
      maxTokens: this.options.maxTokens ?? 2000
    });

    return parseExtractionResponse(output);
  }

  /**
   * 去重并持久化一条记忆
   */
  private async dedupeAndPersist(
    mem: ExtractedMemory,
    memoryType: MemoryType,
    resourceId: string | null
  ): Promise<
    | { type: 'new'; item: StructuredMemoryItem }
    | { type: 'reinforced'; id: string; newCount: number }
    | { type: 'skipped' }
  > {
    const hash = computeContentHash(mem.content, memoryType);

    const existing = await this.storage.findItemByHash(hash);
    if (existing) {
      await this.storage.reinforceItem(existing.id);
      const updated = await this.storage.getItem(existing.id);
      return {
        type: 'reinforced',
        id: existing.id,
        newCount: updated?.reinforcementCount ?? existing.reinforcementCount + 1
      };
    }

    const item = await this.storage.createItem({
      resourceId,
      memoryType,
      summary: mem.content,
      contentHash: hash,
      reinforcementCount: 1,
      lastReinforcedAt: nowISO()
    });

    // 创建分类关系
    for (const catName of mem.categories) {
      const cat = await this.storage.getCategoryByName(catName);
      if (cat) {
        await this.storage.createCategoryItem({ itemId: item.id, categoryId: cat.id });
      }
    }

    return { type: 'new', item };
  }

  /**
   * 确保默认分类存在于数据库中
   */
  private async ensureCategories(): Promise<void> {
    for (const def of DEFAULT_CATEGORIES) {
      const existing = await this.storage.getCategoryByName(def.name);
      if (!existing) {
        await this.storage.createCategory({
          name: def.name,
          description: def.description
        });
      }
    }
  }
}
