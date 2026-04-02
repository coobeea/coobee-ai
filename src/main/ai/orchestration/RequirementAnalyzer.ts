/**
 * 需求分析器（Requirement Analyzer）
 * 负责分析用户需求，判断任务类型，生成需求分析文档
 */

import { z } from 'zod';
import { createLogger } from '@main/common/logger';
import type { Task } from './types';

const log = createLogger('orchestration:requirement-analyzer');

// ========== 需求分析结果 Schema ==========

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RequirementAnalysisSchema = z.object({
  // 任务分类
  taskType: z.enum(['simple-chat', 'simple-query', 'complex-task']).describe('任务类型：简单对话、简单查询、复杂任务'),

  // 是否需要编排
  needsOrchestration: z.boolean().describe('是否需要多智能体编排（复杂任务才需要）'),

  // 分类依据
  reason: z.string().describe('分类依据（一句话说明）'),

  // 需求分析（仅复杂任务）
  analysis: z
    .object({
      coreObjective: z.string().describe('核心目标（一句话）'),
      keyRequirements: z.array(z.string()).describe('关键需求列表'),
      technicalChallenges: z.array(z.string()).default([]).describe('技术挑战点'),
      expectedDeliverables: z.array(z.string()).default([]).describe('预期交付物'),
      estimatedComplexity: z.enum(['low', 'medium', 'high']).describe('复杂度评估')
    })
    .optional()
    .describe('需求分析（仅复杂任务生成）')
});

/** 需求分析结果 */
export type RequirementAnalysisResult = z.infer<typeof RequirementAnalysisSchema>;

/**
 * 需求分析器接口
 */
export interface IRequirementAnalyzer {
  /**
   * 分析需求
   * @param task 任务定义
   */
  analyze(task: Task): Promise<RequirementAnalysisResult>;
}

/**
 * 需求分析器实现
 *
 * 通过 AgentRuntime 创建一个临时的 Analyzer Agent，
 * 让 LLM 分析用户需求，判断任务类型，生成需求分析文档。
 */
export class RequirementAnalyzer implements IRequirementAnalyzer {
  // 暂无初始化逻辑，保留供未来扩展（LLM 配置、缓存等）

  /**
   * 分析需求
   */
  async analyze(task: Task): Promise<RequirementAnalysisResult> {
    const prompt = this.buildAnalysisPrompt(task);
    const output = await this.callAnalyzerAgent(prompt);

    if (!output) {
      log.warn('[RequirementAnalyzer] No structured output, using fallback');
      return this.getFallbackAnalysis(task);
    }

    log.info(
      `[RequirementAnalyzer] Analysis complete: taskType=${output.taskType}, ` +
        `needsOrchestration=${output.needsOrchestration}`
    );

    return output;
  }

  /**
   * 构建需求分析提示词
   */
  private buildAnalysisPrompt(task: Task): string {
    let prompt = `你是一个需求分析专家。请分析以下用户需求，判断任务类型并给出分析报告。\n\n`;

    prompt += `**用户需求**\n`;
    prompt += `目标：${task.objective}\n`;

    if (task.description) {
      prompt += `描述：${task.description}\n`;
    }

    if (task.requirements?.length) {
      prompt += `要求：\n${task.requirements.map((r) => `- ${r}`).join('\n')}\n`;
    }

    if (task.context) {
      prompt += `上下文：\n${JSON.stringify(task.context, null, 2)}\n`;
    }

    prompt += `\n**任务分类标准**\n\n`;

    prompt += `1. **simple-chat（简单对话）**\n`;
    prompt += `   - 特征：打招呼、感谢、确认、闲聊\n`;
    prompt += `   - 示例："你好"、"谢谢"、"再见"、"在吗"\n`;
    prompt += `   - 处理：直接回复，不需要编排\n\n`;

    prompt += `2. **simple-query（简单查询）**\n`;
    prompt += `   - 特征：单一问题、查询类需求、不需要多步骤\n`;
    prompt += `   - 示例："今天几点"、"天气怎么样"、"什么是 TypeScript"\n`;
    prompt += `   - 处理：单智能体查询，不需要编排\n\n`;

    prompt += `3. **complex-task（复杂任务）**\n`;
    prompt += `   - 特征：需要多步骤、涉及多领域、项目开发、系统设计\n`;
    prompt += `   - 示例："开发一个音乐播放器"、"设计用户管理系统"、"实现前后端分离架构"\n`;
    prompt += `   - 处理：需要多智能体编排协作\n\n`;

    prompt += `**输出要求**\n\n`;
    prompt += `请以 JSON 格式输出分析结果（不要使用 Markdown 代码块）：\n\n`;

    prompt += `如果是简单对话或查询：\n`;
    prompt += `{\n`;
    prompt += `  "taskType": "simple-chat" | "simple-query",\n`;
    prompt += `  "needsOrchestration": false,\n`;
    prompt += `  "reason": "这是一个简单的XXX，不需要编排"\n`;
    prompt += `}\n\n`;

    prompt += `如果是复杂任务：\n`;
    prompt += `{\n`;
    prompt += `  "taskType": "complex-task",\n`;
    prompt += `  "needsOrchestration": true,\n`;
    prompt += `  "reason": "这是一个复杂任务，需要多智能体协作",\n`;
    prompt += `  "analysis": {\n`;
    prompt += `    "coreObjective": "核心目标（一句话）",\n`;
    prompt += `    "keyRequirements": ["需求1", "需求2", ...],\n`;
    prompt += `    "technicalChallenges": ["挑战1", "挑战2", ...],\n`;
    prompt += `    "expectedDeliverables": ["交付物1", "交付物2", ...],\n`;
    prompt += `    "estimatedComplexity": "low" | "medium" | "high"\n`;
    prompt += `  }\n`;
    prompt += `}\n\n`;

    prompt += `**重要提示**\n`;
    prompt += `- 必须严格按照 JSON 格式输出\n`;
    prompt += `- taskType 必须是 simple-chat、simple-query 或 complex-task\n`;
    prompt += `- 简单任务只需要 taskType、needsOrchestration、reason 三个字段\n`;
    prompt += `- 复杂任务必须包含完整的 analysis 对象\n`;

    return prompt;
  }

  /**
   * 调用 Analyzer Agent（暂时使用启发式规则，未来可用 LLM 增强）
   */
  private async callAnalyzerAgent(_prompt: string): Promise<RequirementAnalysisResult | null> {
    // TODO: 使用 LLM 进行更智能的分析
    // 当前使用启发式规则快速实现，验证流程后再用 LLM 增强
    log.info('[RequirementAnalyzer] Using heuristic analysis (LLM analysis coming soon)');
    return null; // 降级到 getFallbackAnalysis
  }

  /**
   * 降级分析（当 LLM 调用失败时）
   */
  private getFallbackAnalysis(task: Task): RequirementAnalysisResult {
    const objective = task.objective.trim().toLowerCase();

    // 简单启发式判断
    const greetings = ['你好', 'hi', 'hello', '嗨', '您好', '谢谢', '再见', 'bye', '在吗'];
    if (greetings.some((g) => objective === g || objective === g + '！' || objective === g + '!')) {
      return {
        taskType: 'simple-chat',
        needsOrchestration: false,
        reason: '这是一个简单的问候或闲聊，不需要编排'
      };
    }

    // 简单查询特征
    if (objective.length < 20 && /^(今天|现在|什么是|怎么)/.test(objective)) {
      return {
        taskType: 'simple-query',
        needsOrchestration: false,
        reason: '这是一个简单的查询问题，不需要编排'
      };
    }

    // 复杂任务特征
    const complexKeywords = ['开发', '创建', '实现', '设计', '构建', '搭建', '系统', '项目', '架构'];
    if (complexKeywords.some((kw) => objective.includes(kw))) {
      return {
        taskType: 'complex-task',
        needsOrchestration: true,
        reason: '这是一个复杂的开发任务，需要多智能体协作',
        analysis: {
          coreObjective: task.objective,
          keyRequirements: task.requirements || [],
          technicalChallenges: [],
          expectedDeliverables: [],
          estimatedComplexity: 'medium'
        }
      };
    }

    // 默认：简单查询
    return {
      taskType: 'simple-query',
      needsOrchestration: false,
      reason: '未能明确判断任务类型，默认为简单查询'
    };
  }
}

// 未来可用 LLM 增强需求分析（Agent Instructions、结构化输出等）
