/**
 * KnowledgeBaseDataSource - 知识库数据源
 *
 * 职责：
 *   1. 从指定知识库路径读取内容
 *   2. 调用 training-data-generator Agent
 *   3. 分批生成训练任务（如果一次生成不完）
 *   4. 返回 trainSet + testSet
 */

import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import { log as logger } from '@main/common/logger';
import { Env } from '@main/common/env';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { TrainingDataset, TrainingTask, TrainingGoal } from '../types';

export interface KnowledgeBaseDataSourceConfig {
  /** 知识库路径（相对于 userHome） */
  path: string;
  /** 训练目标 */
  trainingGoal: TrainingGoal;
  /** 智能体 ID */
  agentId: string;
  /** 技能包名称 */
  skillName: string;
}

export interface DataGenerationOptions {
  /** 总任务数量 */
  totalCount: number;
  /** 训练集:测试集比例（默认 0.8） */
  trainTestRatio?: number;
  /** 每批生成数量（默认 30） */
  batchSize?: number;
}

export class KnowledgeBaseDataSource {
  private runtime: ChannelRuntime;
  private config: KnowledgeBaseDataSourceConfig;

  constructor(config: KnowledgeBaseDataSourceConfig) {
    this.runtime = ChannelRuntime.getInstance();
    this.config = config;
  }

  /**
   * 生成训练数据集
   *
   * @param options - 生成选项
   * @returns 完整的数据集（trainSet + testSet）
   */
  async generate(options: DataGenerationOptions): Promise<TrainingDataset> {
    logger.info(`[KnowledgeBaseDataSource] 开始生成数据集: ${options.totalCount} 个任务`);

    try {
      // 1. 读取知识库内容
      const knowledgeContent = await this.readKnowledgeBase();

      // 2. 分批生成任务
      const allTasks = await this.generateTasksInBatches(knowledgeContent, options);

      // 3. 分割为训练集和测试集
      const { trainSet, testSet } = this.splitTrainTest(allTasks, options.trainTestRatio || 0.8);

      // 4. 构建数据集对象
      const dataset: TrainingDataset = {
        name: `${this.config.skillName}-training`,
        version: '1.0',
        category: this.config.skillName,
        trainSet,
        testSet
      };

      logger.info(`[KnowledgeBaseDataSource] 数据集生成完成: 训练集 ${trainSet.length}, 测试集 ${testSet.length}`);

      return dataset;
    } catch (error) {
      logger.error(`[KnowledgeBaseDataSource] 数据集生成失败:`, error);
      throw error;
    }
  }

  /**
   * 读取知识库内容
   */
  private async readKnowledgeBase(): Promise<string> {
    try {
      const fullPath = path.join(Env.paths.userHome, this.config.path);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`知识库路径不存在: ${fullPath}`);
      }

      const stat = fs.statSync(fullPath);

      if (stat.isFile()) {
        // 单个文件
        const content = fs.readFileSync(fullPath, 'utf-8');
        return content;
      } else if (stat.isDirectory()) {
        // 目录：读取所有 .md 文件
        const files = this.findMarkdownFiles(fullPath);
        const contents = files.map((file) => {
          const content = fs.readFileSync(file, 'utf-8');
          return `# ${path.basename(file)}\n\n${content}`;
        });
        return contents.join('\n\n---\n\n');
      } else {
        throw new Error(`不支持的知识库类型: ${fullPath}`);
      }
    } catch (error) {
      logger.error(`[KnowledgeBaseDataSource] 读取知识库失败:`, error);
      throw error;
    }
  }

  /**
   * 查找目录下的所有 Markdown 文件
   */
  private findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];

    const walk = (currentPath: string): void => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    };

    walk(dir);
    return files;
  }

  /**
   * 分批生成任务
   */
  private async generateTasksInBatches(
    knowledgeContent: string,
    options: DataGenerationOptions
  ): Promise<TrainingTask[]> {
    const batchSize = options.batchSize || 30;
    const totalCount = options.totalCount;
    const allTasks: TrainingTask[] = [];

    logger.info(`[KnowledgeBaseDataSource] 开始分批生成，每批 ${batchSize} 个任务`);

    let remaining = totalCount;
    let batchIndex = 1;

    while (remaining > 0) {
      const currentBatchSize = Math.min(remaining, batchSize);

      logger.info(`[KnowledgeBaseDataSource] 生成第 ${batchIndex} 批: ${currentBatchSize} 个任务 (剩余 ${remaining})`);

      try {
        const tasks = await this.generateBatch(knowledgeContent, currentBatchSize, batchIndex);
        allTasks.push(...tasks);

        remaining -= currentBatchSize;
        batchIndex++;
      } catch (error) {
        logger.error(`[KnowledgeBaseDataSource] 第 ${batchIndex} 批生成失败:`, error);
        // 继续尝试下一批（不中断）
      }
    }

    logger.info(`[KnowledgeBaseDataSource] 分批生成完成，共 ${allTasks.length} 个任务`);
    return allTasks;
  }

  /**
   * 生成一批任务
   */
  private async generateBatch(knowledgeContent: string, count: number, batchIndex: number): Promise<TrainingTask[]> {
    const prompt = this.buildDataGenerationPrompt(knowledgeContent, count, batchIndex);

    // 调用 training-data-generator Agent
    const result = await this.runtime.executeAgent({
      agentId: 'training-data-generator', // 专门的数据生成 Agent
      sessionId: `data-gen-${this.config.skillName}-${Date.now()}-${batchIndex}`,
      message: prompt,
      context: {
        channel: 'training',
        source: 'training',
        channelType: 'training',
        metadata: {
          skillName: this.config.skillName,
          batchIndex
        }
      }
    });

    if (result.error) {
      throw new Error(`调用 training-data-generator 失败: ${result.error}`);
    }

    // 解析任务列表
    return this.parseTasksFromResponse(result.output, batchIndex);
  }

  /**
   * 构建数据生成 Prompt
   */
  private buildDataGenerationPrompt(knowledgeContent: string, count: number, batchIndex: number): string {
    // 截取知识库内容（避免过长）
    const maxLength = 10000;
    const truncatedContent =
      knowledgeContent.length > maxLength
        ? knowledgeContent.substring(0, maxLength) + '\n\n...(内容过长，已截断)'
        : knowledgeContent;

    return `
你是一个训练数据生成专家。请从以下知识库内容中提取信息，生成 ${count} 个训练任务。

**训练场景**：
- 智能体：${this.config.agentId}
- 使用技能包：${this.config.skillName}
- 训练目标：${this.config.trainingGoal.name}
- 训练目标描述：${this.config.trainingGoal.description}

**评估维度**：
${this.config.trainingGoal.dimensions.map((d) => `- ${d.label}：${d.description}`).join('\n')}

**知识库内容**：

\`\`\`
${truncatedContent}
\`\`\`

**任务要求**：

请生成 ${count} 个训练任务，每个任务应该：
1. 基于知识库内容提取真实场景
2. 要求智能体使用 ${this.config.skillName} 技能解决问题
3. 覆盖不同的问题类型和难度
4. 任务描述清晰具体，可直接执行

**输出格式**（JSON 数组）：

\`\`\`json
[
  {
    "id": "task-${batchIndex}-001",
    "description": "任务描述（场景 + 要求）",
    "expectedAction": "使用 ${this.config.skillName} 技能执行的具体动作",
    "knowledgeContext": "从知识库提取的相关上下文（简要）",
    "difficulty": 3,
    "category": "问题类别"
  }
]
\`\`\`

**注意**：
- difficulty: 1-5（1=简单，5=困难）
- 请直接输出 JSON 数组，不要其他说明文字
- 确保任务可以训练智能体使用 ${this.config.skillName} 技能

开始生成：
    `.trim();
  }

  /**
   * 从响应中解析任务列表
   */
  private parseTasksFromResponse(response: string, batchIndex: number): TrainingTask[] {
    try {
      // 提取 JSON（可能被包裹在 markdown 代码块中）
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || response.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        throw new Error('无法从响应中提取 JSON');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        throw new Error('响应不是 JSON 数组');
      }

      // 转换为 TrainingTask 类型
      const tasks: TrainingTask[] = parsed.map((item: Record<string, unknown>, index: number) => {
        let difficulty = Number(item.difficulty || 3);
        // 确保 difficulty 在 1-5 范围内
        if (difficulty < 1 || difficulty > 5) {
          difficulty = 3;
        }

        // 处理 testCase，如果是对象则转为 JSON 字符串
        let testCase: string | undefined;
        if (item.expectedAction) {
          testCase =
            typeof item.expectedAction === 'string' ? item.expectedAction : JSON.stringify(item.expectedAction);
        }

        return {
          id: String(item.id || `task-${batchIndex}-${String(index + 1).padStart(3, '0')}`),
          description: String(item.description || ''),
          difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
          category: String(item.category || 'general'),
          testCase,
          knowledgeContext: item.knowledgeContext
        } as TrainingTask;
      });

      return tasks;
    } catch (error) {
      logger.error(`[KnowledgeBaseDataSource] 解析任务列表失败:`, error);
      logger.debug(`[KnowledgeBaseDataSource] 原始响应:`, response);

      // 返回空数组（不中断流程）
      return [];
    }
  }

  /**
   * 分割训练集和测试集
   */
  private splitTrainTest(tasks: TrainingTask[], ratio: number): { trainSet: TrainingTask[]; testSet: TrainingTask[] } {
    // 打乱顺序
    const shuffled = [...tasks].sort(() => Math.random() - 0.5);

    // 分割
    const trainCount = Math.floor(shuffled.length * ratio);
    const trainSet = shuffled.slice(0, trainCount);
    const testSet = shuffled.slice(trainCount);

    return { trainSet, testSet };
  }
}
