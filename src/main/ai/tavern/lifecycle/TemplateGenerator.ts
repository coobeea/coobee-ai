/**
 * TemplateGenerator - 模板生成器
 *
 * 根据模板常量生成实际的 Markdown 文件，支持变量替换
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { Task } from '../TavernStore';
import type { TemplateVariables } from '../types';
import { LIFECYCLE_TEMPLATES, DEFAULT_TEMPLATE_VARS } from './templates';

const log = createLogger('template-generator');

export class TemplateGenerator {
  /**
   * 生成所有模板文件
   *
   * @param lifecycleDir - lifecycle 目录路径
   * @param task - 任务定义
   * @param sessionId - 会话 ID
   */
  async generate(lifecycleDir: string, task: Task, sessionId: string): Promise<void> {
    try {
      log.info(`[TemplateGenerator] Generating templates for task ${task.id}`);

      // 确保目录存在
      await fs.promises.mkdir(lifecycleDir, { recursive: true });

      // 准备模板变量
      const variables = this.prepareVariables(task, sessionId);

      // 并行生成所有模板文件
      const writes = Object.entries(LIFECYCLE_TEMPLATES).map(async ([filename, template]) => {
        // 跳过占位符文件
        if (filename === '.gitkeep') return;

        const filePath = path.join(lifecycleDir, filename);
        const content = this.renderTemplate(template.content, variables);

        await fs.promises.writeFile(filePath, content, 'utf-8');
        log.debug(`[TemplateGenerator] Generated: ${filename}`);
      });

      await Promise.all(writes);

      log.info(
        `[TemplateGenerator] All templates generated successfully (${Object.keys(LIFECYCLE_TEMPLATES).length - 1} files)`
      );
    } catch (err) {
      log.error(`[TemplateGenerator] Failed to generate templates:`, err);
      throw new Error(`模板生成失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 准备模板变量
   */
  private prepareVariables(task: Task, sessionId: string): TemplateVariables {
    return {
      date: DEFAULT_TEMPLATE_VARS.date(),
      timestamp: DEFAULT_TEMPLATE_VARS.timestamp(),
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      sessionId
    };
  }

  /**
   * 渲染模板（替换变量）
   *
   * @param template - 模板字符串
   * @param variables - 变量对象
   * @returns 渲染后的内容
   */
  private renderTemplate(template: string, variables: TemplateVariables): string {
    let result = template;

    // 替换所有 {{var}} 变量
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const replacement = String(value);
      result = result.split(placeholder).join(replacement);
    }

    return result;
  }

  /**
   * 检测已生成的文档
   *
   * @param lifecycleDir - lifecycle 目录路径
   * @returns 已存在的文档文件名列表
   */
  async detectExistingDocuments(lifecycleDir: string): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(lifecycleDir);
      return files.filter((f) => f.endsWith('.md') && f !== 'README.md');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * 读取文档内容
   *
   * @param lifecycleDir - lifecycle 目录路径
   * @param filename - 文件名
   * @returns 文档内容，如果文件不存在返回 null
   */
  async readDocument(lifecycleDir: string, filename: string): Promise<string | null> {
    try {
      const filePath = path.join(lifecycleDir, filename);
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      log.error(`[TemplateGenerator] Failed to read document ${filename}:`, err);
      throw err;
    }
  }

  /**
   * 检测已完成的阶段（根据文档文件是否存在且有内容）
   *
   * @param lifecycleDir - lifecycle 目录路径
   * @returns 已完成的阶段列表
   */
  async detectCompletedStages(lifecycleDir: string): Promise<string[]> {
    const stageFiles = [
      { file: '01-需求分析.md', stage: 'requirement-analysis' },
      { file: '02-方案设计.md', stage: 'solution-design' },
      { file: '03-反思优化.md', stage: 'reflection' },
      { file: '04-TODO.md', stage: 'implementation' },
      { file: '07-验收报告.md', stage: 'acceptance' }
    ];

    const completed: string[] = [];

    for (const { file, stage } of stageFiles) {
      const content = await this.readDocument(lifecycleDir, file);
      if (content && this.isDocumentCompleted(content)) {
        completed.push(stage);
      }
    }

    return completed;
  }

  /**
   * 判断文档是否已完成（内容不是模板占位符）
   *
   * @param content - 文档内容
   * @returns 是否已完成
   */
  private isDocumentCompleted(content: string): boolean {
    // 如果包含大量占位符（[请描述]、[说明]、[任务名称] 等），认为未完成
    const specificPlaceholders = [
      '[请描述',
      '[请说明',
      '[请列出',
      '[请思考',
      '[请评估',
      '[请分析',
      '[为什么',
      '[如何',
      '[是否',
      '[任务名称]',
      '[具体要做什么',
      '[文件路径',
      '[约 X 行]',
      '[标准 1',
      '[模块 1]',
      '[涉及哪些',
      '[方案名称]',
      '[问题描述]',
      '[修复方案]'
    ];

    const placeholderCount = specificPlaceholders.reduce((count, placeholder) => {
      // 转义方括号以避免正则表达式错误
      const escapedPlaceholder = placeholder.replace(/[[\]]/g, '\\$&');
      const matches = content.match(new RegExp(escapedPlaceholder, 'g'));
      return count + (matches ? matches.length : 0);
    }, 0);

    // 如果占位符超过 5 个，认为文档未完成（提高阈值，因为增加了检测项）
    return placeholderCount < 5;
  }

  /**
   * 获取下一个应执行的阶段
   *
   * @param completedStages - 已完成的阶段列表
   * @returns 下一个阶段名称
   */
  getNextStage(completedStages: string[]): string {
    const allStages = ['requirement-analysis', 'solution-design', 'reflection', 'implementation', 'acceptance'];

    for (const stage of allStages) {
      if (!completedStages.includes(stage)) {
        return stage;
      }
    }

    return 'completed';
  }
}
