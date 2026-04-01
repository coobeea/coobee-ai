/**
 * TemplateGenerator - 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TemplateGenerator } from '../TemplateGenerator';
import type { Task } from '../../TavernStore';

// Mock logger
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('TemplateGenerator', () => {
  let tempDir: string;
  let generator: TemplateGenerator;
  let mockTask: Task;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, 'test-template-'));
    generator = new TemplateGenerator();

    mockTask = {
      id: 'test-task-456',
      title: '测试模板生成',
      description: '这是测试任务描述',
      amount: 50,
      files: ['test.ts'],
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  afterEach(async () => {
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('generate', () => {
    it('should generate all template files', async () => {
      await generator.generate(tempDir, mockTask, 'session-456');

      const files = await fs.promises.readdir(tempDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      expect(mdFiles).toContain('01-需求分析.md');
      expect(mdFiles).toContain('02-方案设计.md');
      expect(mdFiles).toContain('03-反思优化.md');
      expect(mdFiles).toContain('04-TODO.md');
      expect(mdFiles).toContain('05-PROGRESS.md');
      expect(mdFiles).toContain('06-BUGS.md');
      expect(mdFiles).toContain('07-验收报告.md');
      expect(mdFiles).toContain('08-综合报告.md');
      expect(mdFiles).toContain('README.md');
    });

    it('should replace template variables', async () => {
      await generator.generate(tempDir, mockTask, 'session-456');

      const content = await fs.promises.readFile(path.join(tempDir, '01-需求分析.md'), 'utf-8');

      expect(content).toContain(mockTask.title);
      expect(content).toContain(mockTask.id);
      expect(content).toContain('session-456');
      expect(content).toContain(mockTask.description);
      expect(content).not.toContain('{{taskTitle}}');
      expect(content).not.toContain('{{taskId}}');
    });

    it('should create directory if not exists', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'lifecycle');

      await generator.generate(nestedDir, mockTask, 'session-456');

      expect(fs.existsSync(nestedDir)).toBe(true);
      const files = await fs.promises.readdir(nestedDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it('should throw error if write fails', async () => {
      // 使用不可写的目录（权限测试）
      const readonlyDir = '/this-should-not-exist-xyz';

      await expect(generator.generate(readonlyDir, mockTask, 'session-456')).rejects.toThrow('模板生成失败');
    });
  });

  describe('detectExistingDocuments', () => {
    it('should detect existing markdown files', async () => {
      await generator.generate(tempDir, mockTask, 'session-456');

      const existing = await generator.detectExistingDocuments(tempDir);

      expect(existing).toContain('01-需求分析.md');
      expect(existing).toContain('02-方案设计.md');
      expect(existing).not.toContain('README.md'); // 应排除
    });

    it('should return empty array if directory not exists', async () => {
      const nonExistDir = path.join(tempDir, 'not-exist');

      const existing = await generator.detectExistingDocuments(nonExistDir);

      expect(existing).toEqual([]);
    });
  });

  describe('detectCompletedStages', () => {
    it('should detect completed stages', async () => {
      await generator.generate(tempDir, mockTask, 'session-456');

      // 模拟完成阶段一（写入完整内容）
      const content = `# 需求分析

## 需求背景
完整的需求背景描述，内容充实。

## 核心目标
明确的核心目标列表。

## 技术评估
详细的技术评估分析。

## 约束条件
各种约束条件说明。

## 涉及范围
涉及的模块和文件列表。
`;

      await fs.promises.writeFile(path.join(tempDir, '01-需求分析.md'), content, 'utf-8');

      const completed = await generator.detectCompletedStages(tempDir);

      expect(completed).toContain('requirement-analysis');
    });

    it('should not detect incomplete stages (template only)', async () => {
      await generator.generate(tempDir, mockTask, 'session-456');

      // 不修改文件（保持模板状态）
      const completed = await generator.detectCompletedStages(tempDir);

      // 模板文件包含大量占位符，不应被识别为已完成
      expect(completed).toHaveLength(0);
    });
  });

  describe('getNextStage', () => {
    it('should return next stage', () => {
      const completed = ['requirement-analysis'];
      const next = generator.getNextStage(completed);
      expect(next).toBe('solution-design');
    });

    it('should return completed if all stages done', () => {
      const completed = ['requirement-analysis', 'solution-design', 'reflection', 'implementation', 'acceptance'];
      const next = generator.getNextStage(completed);
      expect(next).toBe('completed');
    });

    it('should return first stage if none completed', () => {
      const completed: string[] = [];
      const next = generator.getNextStage(completed);
      expect(next).toBe('requirement-analysis');
    });
  });
});
