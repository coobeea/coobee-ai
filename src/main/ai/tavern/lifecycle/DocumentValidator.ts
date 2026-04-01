/**
 * DocumentValidator - 文档验证器
 *
 * 职责：
 * 1. 验证文档格式完整性（检查必需章节）
 * 2. 给文档质量打分（0-100）
 * 3. 生成验证报告（错误、警告）
 */

import { createLogger } from '@main/common/logger';
import { LIFECYCLE_TEMPLATES } from './templates';
import type { ValidationResult } from '../types';

const log = createLogger('document-validator');

export class DocumentValidator {
  /**
   * 验证文档
   *
   * @param filename - 文件名（如 "01-需求分析.md"）
   * @param content - 文档内容
   * @returns 验证结果
   */
  validate(filename: string, content: string): ValidationResult {
    const template = LIFECYCLE_TEMPLATES[filename];
    if (!template) {
      return {
        valid: false,
        score: 0,
        errors: [`未知文档类型: ${filename}`],
        warnings: []
      };
    }

    // 检查必需章节
    const missingSections = this.checkMissingSections(content, template.sections);

    // 计算质量评分
    const score = this.calculateScore(content, template.sections, missingSections);

    // 检测敏感信息（警告）
    const sensitiveInfoWarnings = this.detectSensitiveInfo(content);

    const result: ValidationResult = {
      valid: missingSections.length === 0,
      score,
      errors: missingSections.map((s) => `缺少必需章节: ${s}`),
      warnings: sensitiveInfoWarnings,
      missingSections,
      completeness: Math.round((1 - missingSections.length / template.sections.length) * 100)
    };

    if (!result.valid || result.score < 80) {
      log.warn(`[DocumentValidator] Document validation result for ${filename}:`, {
        valid: result.valid,
        score: result.score,
        errors: result.errors
      });
    } else {
      log.info(`[DocumentValidator] Document ${filename} validated successfully (score: ${result.score})`);
    }

    return result;
  }

  /**
   * 检查缺失的章节
   */
  private checkMissingSections(content: string, requiredSections: string[]): string[] {
    const missing: string[] = [];

    for (const section of requiredSections) {
      // 检查是否包含 "## 章节名"
      if (!content.includes(`## ${section}`)) {
        missing.push(section);
      }
    }

    return missing;
  }

  /**
   * 计算文档质量评分（0-100）
   *
   * 评分规则：
   * - 章节完整性：60 分（每个必需章节占 60/N 分）
   * - 内容丰富度：30 分（基于内容长度）
   * - 格式规范性：10 分（标题、列表、代码块）
   */
  private calculateScore(content: string, requiredSections: string[], missingSections: string[]): number {
    let score = 0;

    // 1. 章节完整性（60 分）
    const sectionScore = ((requiredSections.length - missingSections.length) / requiredSections.length) * 60;
    score += sectionScore;

    // 2. 内容丰富度（30 分）
    const contentLength = content.length;
    let contentScore = 0;
    if (contentLength < 500) {
      contentScore = 5;
    } else if (contentLength < 1000) {
      contentScore = 15;
    } else if (contentLength < 2000) {
      contentScore = 25;
    } else {
      contentScore = 30;
    }
    score += contentScore;

    // 3. 格式规范性（10 分）
    let formatScore = 0;
    if (content.includes('##')) formatScore += 3; // 有二级标题
    if (content.includes('- ') || content.includes('1. ')) formatScore += 3; // 有列表
    if (content.includes('```')) formatScore += 2; // 有代码块
    if (content.includes('| ') && content.includes('|')) formatScore += 2; // 有表格
    score += formatScore;

    return Math.round(score);
  }

  /**
   * 检测敏感信息（警告）
   *
   * @param content - 文档内容
   * @returns 警告列表
   */
  private detectSensitiveInfo(content: string): string[] {
    const warnings: string[] = [];

    const patterns = [
      { pattern: /api[_-]?key\s*[:=]\s*[\w-]{20,}/gi, message: '可能包含 API Key' },
      { pattern: /password\s*[:=]\s*\w{6,}/gi, message: '可能包含密码' },
      { pattern: /token\s*[:=]\s*[\w.-]{20,}/gi, message: '可能包含 Token' },
      { pattern: /secret\s*[:=]\s*[\w-]{20,}/gi, message: '可能包含 Secret' }
    ];

    for (const { pattern, message } of patterns) {
      if (pattern.test(content)) {
        warnings.push(message);
      }
    }

    return warnings;
  }

  /**
   * 生成修正建议（当文档质量低时）
   *
   * @param filename - 文件名
   * @param result - 验证结果
   * @returns 修正建议（Prompt 格式）
   */
  generateRevisionPrompt(filename: string, result: ValidationResult): string {
    const parts = [
      `文档「${filename}」质量不足，需要修正。`,
      '',
      `**当前评分**：${result.score}/100`,
      '',
      '**问题清单**：'
    ];

    if (result.errors.length > 0) {
      parts.push('', '**错误**（必须修复）：');
      result.errors.forEach((err, i) => {
        parts.push(`${i + 1}. ${err}`);
      });
    }

    if (result.warnings.length > 0) {
      parts.push('', '**警告**（建议优化）：');
      result.warnings.forEach((warn, i) => {
        parts.push(`${i + 1}. ${warn}`);
      });
    }

    parts.push(
      '',
      '**修正要求**：',
      '1. 补全所有缺失的章节',
      '2. 增加内容丰富度（每个章节至少 100 字）',
      '3. 确保格式规范（使用标题、列表、表格）',
      '4. 移除或替换敏感信息（如有）',
      '',
      `请重新编写 \`lifecycle/${filename}\`，确保质量评分 > 80 分。`
    );

    return parts.join('\n');
  }
}
