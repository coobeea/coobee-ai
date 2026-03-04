/**
 * MemoryManager - 长期记忆管理器
 */

import { createLogger } from '@main/common/logger';
import type { MemoryItem, MemoryConfig, MemoryQueryOptions } from './types';

const log = createLogger('memory-manager');

export class MemoryManager {
  private memories = new Map<string, MemoryItem>();
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /**
   * 添加记忆
   */
  addMemory(
    agentId: string,
    type: MemoryItem['type'],
    content: string,
    importance: number,
    metadata?: Record<string, unknown>
  ): MemoryItem {
    const id = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const memory: MemoryItem = {
      id,
      agentId,
      type,
      content,
      importance: Math.max(0, Math.min(1, importance)),
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: now,
      metadata
    };

    this.memories.set(id, memory);

    log.info(`[MemoryManager] Added memory: ${id} (importance: ${importance})`);

    this.pruneIfNeeded();

    return memory;
  }

  /**
   * 查询记忆
   */
  queryMemories(options: MemoryQueryOptions = {}): MemoryItem[] {
    let results = Array.from(this.memories.values());

    if (options.agentId) {
      results = results.filter((m) => m.agentId === options.agentId);
    }

    if (options.type) {
      results = results.filter((m) => m.type === options.type);
    }

    if (options.minImportance !== undefined) {
      results = results.filter((m) => m.importance >= options.minImportance!);
    }

    const sortBy = options.sortBy || 'importance';

    if (sortBy === 'importance') {
      results.sort((a, b) => b.importance - a.importance);
    } else if (sortBy === 'recency') {
      results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    } else if (sortBy === 'access') {
      results.sort((a, b) => b.accessCount - a.accessCount);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessedAt = Date.now();
    }

    return results;
  }

  /**
   * 更新重要性
   */
  updateImportance(memoryId: string, importance: number): boolean {
    const memory = this.memories.get(memoryId);

    if (!memory) return false;

    memory.importance = Math.max(0, Math.min(1, importance));
    log.debug(`[MemoryManager] Updated importance for ${memoryId}: ${importance}`);

    return true;
  }

  /**
   * 删除记忆
   */
  deleteMemory(memoryId: string): boolean {
    const deleted = this.memories.delete(memoryId);

    if (deleted) {
      log.info(`[MemoryManager] Deleted memory: ${memoryId}`);
    }

    return deleted;
  }

  /**
   * 修剪低价值记忆
   */
  private pruneIfNeeded(): void {
    if (this.memories.size <= this.config.maxItems) return;

    const sortedMemories = Array.from(this.memories.values()).sort((a, b) => {
      const scoreA = a.importance * (1 + Math.log10(a.accessCount + 1));
      const scoreB = b.importance * (1 + Math.log10(b.accessCount + 1));
      return scoreA - scoreB;
    });

    const toRemove = sortedMemories.slice(0, this.memories.size - this.config.maxItems);

    for (const memory of toRemove) {
      if (memory.importance < this.config.importanceThreshold) {
        this.memories.delete(memory.id);
        log.debug(`[MemoryManager] Pruned memory: ${memory.id}`);
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalMemories: number;
    byType: Record<string, number>;
    avgImportance: number;
    totalAccessCount: number;
  } {
    const memories = Array.from(this.memories.values());

    const byType: Record<string, number> = {};
    let totalImportance = 0;
    let totalAccess = 0;

    for (const memory of memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
      totalImportance += memory.importance;
      totalAccess += memory.accessCount;
    }

    return {
      totalMemories: memories.length,
      byType,
      avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      totalAccessCount: totalAccess
    };
  }
}
