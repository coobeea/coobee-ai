/**
 * LLM 分类功能测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyMemory } from '../pipeline/classify';
import type { ExtensionApi } from '@main/common/extension/types';

describe('classifyMemory', () => {
  let mockApi: ExtensionApi;

  beforeEach(() => {
    mockApi = {
      services: {
        llm: {
          chat: vi.fn()
        }
      }
    } as unknown as ExtensionApi;
  });

  it('should classify user preference', async () => {
    const mockResponse = JSON.stringify({
      shouldRemember: true,
      category: 'preference',
      importance: 8,
      summary: '用户偏好使用文件系统',
      keywords: ['文件系统', '数据库'],
      memory: '用户明确表示倾向使用文件系统存储而非数据库。'
    });

    vi.mocked(mockApi.services.llm.chat).mockResolvedValue(mockResponse);

    const result = await classifyMemory(mockApi, '好的，我们将使用文件系统存储，这样更简单可控。');

    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe('preference');
    expect(result.importance).toBe(8);
    expect(result.keywords).toContain('文件系统');
  });

  it('should classify decision', async () => {
    const mockResponse = JSON.stringify({
      shouldRemember: true,
      category: 'decision',
      importance: 9,
      summary: '决定使用 LanceDB 替换 SQLite',
      keywords: ['LanceDB', 'SQLite', '向量数据库'],
      memory: '团队决定使用 LanceDB 替换原有的 SQLite 作为向量存储方案。'
    });

    vi.mocked(mockApi.services.llm.chat).mockResolvedValue(mockResponse);

    const result = await classifyMemory(mockApi, '好的，我们将使用 LanceDB 替换 SQLite 作为向量存储方案。');

    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe('decision');
    expect(result.importance).toBe(9);
  });

  it('should not remember trivial conversation', async () => {
    const mockResponse = JSON.stringify({
      shouldRemember: false,
      category: 'other',
      importance: 0,
      summary: '',
      keywords: [],
      memory: '',
      reason: '无信息量的简单确认'
    });

    vi.mocked(mockApi.services.llm.chat).mockResolvedValue(mockResponse);

    const result = await classifyMemory(mockApi, '收到，明白了。');

    expect(result.shouldRemember).toBe(false);
  });

  it('should handle LLM response with markdown code block', async () => {
    const mockResponse = `\`\`\`json
{
  "shouldRemember": true,
  "category": "knowledge",
  "importance": 7,
  "summary": "Vue 3 Composition API 最佳实践",
  "keywords": ["Vue3", "Composition API"],
  "memory": "使用 script setup 语法可以获得更好的性能和类型推断。"
}
\`\`\``;

    vi.mocked(mockApi.services.llm.chat).mockResolvedValue(mockResponse);

    const result = await classifyMemory(mockApi, '建议使用 Vue 3 的 script setup 语法。');

    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe('knowledge');
  });

  it('should return default when LLM fails', async () => {
    vi.mocked(mockApi.services.llm.chat).mockRejectedValue(new Error('API timeout'));

    const result = await classifyMemory(mockApi, 'test output');

    expect(result.shouldRemember).toBe(false);
    expect(result.reason).toContain('Classification failed');
  });
});
