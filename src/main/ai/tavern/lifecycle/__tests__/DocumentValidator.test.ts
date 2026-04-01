/**
 * DocumentValidator - 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { DocumentValidator } from '../DocumentValidator';

// Mock logger
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('DocumentValidator', () => {
  const validator = new DocumentValidator();

  describe('validate', () => {
    it('should validate complete document', () => {
      const content = `# 测试任务 - 需求分析

## 需求背景

这是需求背景的详细描述，内容充实完整。

## 核心目标

明确的核心目标列表。

## 技术评估

详细的技术评估内容。

## 约束条件

约束条件说明。

## 涉及范围

涉及范围描述。
`;

      const result = validator.validate('01-需求分析.md', content);

      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThan(65); // 内容较短，降低期望值
      expect(result.errors).toHaveLength(0);
      expect(result.missingSections).toHaveLength(0);
    });

    it('should detect missing sections', () => {
      const content = `# 测试任务 - 需求分析

## 需求背景

这是需求背景。

## 核心目标

核心目标。
`;

      const result = validator.validate('01-需求分析.md', content);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.missingSections).toContain('技术评估');
      expect(result.missingSections).toContain('约束条件');
      expect(result.missingSections).toContain('涉及范围');
    });

    it('should calculate score based on content quality', () => {
      const shortContent = `# 测试

## 需求背景
简短

## 核心目标
简短

## 技术评估
简短

## 约束条件
简短

## 涉及范围
简短
`;

      const longContent = shortContent + '\n详细内容'.repeat(200);

      const shortResult = validator.validate('01-需求分析.md', shortContent);
      const longResult = validator.validate('01-需求分析.md', longContent);

      expect(longResult.score).toBeGreaterThan(shortResult.score);
    });

    it('should detect sensitive information', () => {
      const content = `# 测试

## 需求背景
需要使用 API_KEY=sk-1234567890abcdefghij

## 核心目标
配置 password=mySecretPassword123

## 技术评估
使用 token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9

## 约束条件
正常内容

## 涉及范围
正常内容
`;

      const result = validator.validate('01-需求分析.md', content);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('API Key'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('密码'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('Token'))).toBe(true);
    });

    it('should handle unknown file type', () => {
      const result = validator.validate('unknown.md', 'content');

      expect(result.valid).toBe(false);
      expect(result.score).toBe(0);
      expect(result.errors[0]).toContain('未知文档类型');
    });
  });

  describe('generateRevisionPrompt', () => {
    it('should generate revision prompt for low quality document', () => {
      const result = {
        valid: false,
        score: 45,
        errors: ['缺少必需章节: 技术评估', '缺少必需章节: 约束条件'],
        warnings: ['可能包含 API Key'],
        missingSections: ['技术评估', '约束条件'],
        completeness: 60
      };

      const prompt = validator.generateRevisionPrompt('01-需求分析.md', result);

      expect(prompt).toContain('质量不足');
      expect(prompt).toContain('45/100');
      expect(prompt).toContain('技术评估');
      expect(prompt).toContain('约束条件');
      expect(prompt).toContain('API Key');
      expect(prompt).toContain('修正要求');
    });
  });
});
