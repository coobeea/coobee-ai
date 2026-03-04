/**
 * MemoryManager 和 ContextCompressor 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager } from '../MemoryManager';
import { ContextCompressor } from '../ContextCompressor';
import type { MemoryConfig } from '../types';

describe('MemoryManager', () => {
  let manager: MemoryManager;

  const config: MemoryConfig = {
    maxItems: 100,
    importanceThreshold: 0.3,
    compressionStrategy: 'summary',
    autoCompressionThreshold: 4000
  };

  beforeEach(() => {
    manager = new MemoryManager(config);
  });

  describe('Memory operations', () => {
    it('should add memory', () => {
      const memory = manager.addMemory('agent-1', 'knowledge', '用户喜欢使用 TypeScript', 0.8);

      expect(memory.id).toBeDefined();
      expect(memory.content).toContain('TypeScript');
      expect(memory.importance).toBe(0.8);
    });

    it('should query memories by agent', () => {
      manager.addMemory('agent-1', 'knowledge', 'Memory 1', 0.7);
      manager.addMemory('agent-1', 'skill', 'Memory 2', 0.6);
      manager.addMemory('agent-2', 'knowledge', 'Memory 3', 0.9);

      const results = manager.queryMemories({ agentId: 'agent-1' });

      expect(results.length).toBe(2);
      expect(results.every((m) => m.agentId === 'agent-1')).toBe(true);
    });

    it('should filter by importance', () => {
      manager.addMemory('agent-1', 'knowledge', 'High importance', 0.9);
      manager.addMemory('agent-1', 'knowledge', 'Low importance', 0.2);

      const results = manager.queryMemories({ agentId: 'agent-1', minImportance: 0.5 });

      expect(results.length).toBe(1);
      expect(results[0].importance).toBe(0.9);
    });

    it('should sort by importance', () => {
      manager.addMemory('agent-1', 'knowledge', 'Memory 1', 0.5);
      manager.addMemory('agent-1', 'knowledge', 'Memory 2', 0.9);
      manager.addMemory('agent-1', 'knowledge', 'Memory 3', 0.7);

      const results = manager.queryMemories({ agentId: 'agent-1', sortBy: 'importance' });

      expect(results[0].importance).toBe(0.9);
      expect(results[1].importance).toBe(0.7);
      expect(results[2].importance).toBe(0.5);
    });

    it('should update access count', () => {
      manager.addMemory('agent-1', 'knowledge', 'Test', 0.7);

      manager.queryMemories({ agentId: 'agent-1' });
      manager.queryMemories({ agentId: 'agent-1' });

      const stats = manager.getStatistics();
      expect(stats.totalAccessCount).toBeGreaterThan(0);
    });
  });

  describe('Memory pruning', () => {
    it('should prune when exceeding max items', () => {
      const smallConfig: MemoryConfig = {
        ...config,
        maxItems: 5
      };

      const smallManager = new MemoryManager(smallConfig);

      for (let i = 0; i < 10; i++) {
        smallManager.addMemory('agent-1', 'knowledge', `Memory ${i}`, i / 10);
      }

      const stats = smallManager.getStatistics();
      expect(stats.totalMemories).toBeLessThanOrEqual(5);
    });
  });

  describe('Memory updates', () => {
    it('should update importance', () => {
      const _memory = manager.addMemory('agent-1', 'knowledge', 'Test', 0.5);

      const success = manager.updateImportance(_memory.id, 0.9);
      expect(success).toBe(true);

      const results = manager.queryMemories({ agentId: 'agent-1' });
      expect(results[0].importance).toBe(0.9);
    });

    it('should delete memory', () => {
      const _memory = manager.addMemory('agent-1', 'knowledge', 'Test', 0.5);

      const success = manager.deleteMemory(_memory.id);
      expect(success).toBe(true);

      const results = manager.queryMemories({ agentId: 'agent-1' });
      expect(results.length).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should calculate statistics', () => {
      manager.addMemory('agent-1', 'knowledge', 'Memory 1', 0.8);
      manager.addMemory('agent-1', 'skill', 'Memory 2', 0.6);
      manager.addMemory('agent-2', 'conversation', 'Memory 3', 0.9);

      const stats = manager.getStatistics();

      expect(stats.totalMemories).toBe(3);
      expect(stats.byType['knowledge']).toBe(1);
      expect(stats.avgImportance).toBeCloseTo((0.8 + 0.6 + 0.9) / 3);
    });
  });
});

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    compressor = new ContextCompressor();
  });

  describe('Compression', () => {
    it('should compress using summary strategy', async () => {
      const longText = `这是第一段内容。它包含了一些重要信息。

这是第二段内容。

这是第三段内容。

这是第四段内容。

这是第五段内容，也很重要。`;

      const result = await compressor.compress(longText, 'summary');

      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      expect(result.compressionRatio).toBeLessThan(1);
      expect(result.compressedContent).toContain('第一段');
      expect(result.compressedContent).toContain('第五段');
    });

    it('should compress using embedding strategy', async () => {
      const text = '这是一个测试。这很重要。这是关键信息。普通文本。';

      const result = await compressor.compress(text, 'embedding');

      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
      expect(result.compressedContent).toContain('重要');
    });

    it('should compress using hybrid strategy', async () => {
      const text = `第一段。

第二段，这很重要。

第三段。

第四段，这是关键。

第五段。`;

      const result = await compressor.compress(text, 'hybrid');

      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      expect(result.compressedContent).toContain('关键信息');
    });

    it('should not compress short text', async () => {
      const shortText = '这是一段简短的文本。';

      const result = await compressor.compress(shortText, 'summary');

      expect(result.compressedContent).toBe(shortText);
    });
  });
});
