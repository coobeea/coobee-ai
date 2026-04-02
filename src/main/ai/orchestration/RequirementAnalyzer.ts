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
   * 调用 Analyzer Agent
   *
   * 通过 AgentRuntime 创建临时的 requirement-analyst Agent，
   * 让 LLM 深度分析用户需求，生成详细的需求分析文档。
   */
  private async callAnalyzerAgent(prompt: string): Promise<RequirementAnalysisResult | null> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');
      const { generateSnowflakeId } = await import('@main/utils/SnowflakeIdGenerator');

      const sessionId = generateSnowflakeId();

      const builder = agentExecutor
        .piMono()
        .name('Requirement Analyst')
        .mode('chat')
        .sessionMode('memory')
        .lightweight(true)
        .instructions(REQUIREMENT_ANALYST_INSTRUCTIONS)
        .sessionId(sessionId);

      const runtime = await builder.build();

      try {
        const result = await runtime.run(prompt);
        const output = this.parseStructuredOutput(result.output);
        return output;
      } finally {
        await runtime.destroy?.();
      }
    } catch (error) {
      log.error('[RequirementAnalyzer] LLM analysis failed:', error);
      return null;
    }
  }

  /**
   * 解析 LLM 输出为结构化结果
   */
  private parseStructuredOutput(rawOutput: string): RequirementAnalysisResult | null {
    try {
      // 尝试从代码块提取 JSON
      const jsonMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawOutput;

      // 解析 JSON
      const parsed = JSON.parse(jsonStr);

      // 验证必需字段
      if (!parsed.taskType || typeof parsed.needsOrchestration !== 'boolean') {
        return null;
      }

      return parsed as RequirementAnalysisResult;
    } catch {
      // 解析失败，尝试提取关键信息
      if (rawOutput.includes('complex-task') || rawOutput.includes('needsOrchestration": true')) {
        return {
          taskType: 'complex-task',
          needsOrchestration: true,
          reason: '检测到复杂任务特征'
        };
      }
      return null;
    }
  }

  /**
   * 降级分析（当 LLM 调用失败时）
   *
   * ⚠️ 不使用关键词匹配！
   * 如果 LLM 调用失败，默认认为是复杂任务，进入完整编排流程。
   * 这样虽然可能会有些"大材小用"，但总比误判简单任务为复杂任务要好。
   */
  private getFallbackAnalysis(task: Task): RequirementAnalysisResult {
    log.warn('[RequirementAnalyzer] LLM analysis failed, defaulting to complex-task for safety');

    // 默认：复杂任务，启动完整编排流程
    // 理由：宁可"大材小用"，也不要漏掉真正的复杂任务
    return {
      taskType: 'complex-task',
      needsOrchestration: true,
      reason: 'LLM 分析失败，为安全起见默认为复杂任务',
      analysis: {
        coreObjective: task.objective,
        keyRequirements: task.requirements || [],
        technicalChallenges: ['需要 LLM 进一步分析'],
        expectedDeliverables: ['待 LLM 分析确定'],
        estimatedComplexity: 'medium'
      }
    };
  }
}

// ========== Requirement Analyst Agent 指令 ==========

const REQUIREMENT_ANALYST_INSTRUCTIONS = `你是一个专业的需求分析专家，擅长从用户的模糊需求中提取核心目标、识别技术挑战、评估风险。

你的任务是分析用户需求，判断任务类型，并为复杂任务生成详细的需求分析。

**分析维度**：
1. **任务类型判断**
   - simple-chat: 打招呼、感谢、确认、闲聊（如"你好"、"谢谢"）
   - simple-query: 单一问题、查询类（如"什么是 TypeScript"、"今天几点"）
   - complex-task: 多步骤、项目开发、系统设计（如"开发音乐播放器"、"重构认证系统"）

2. **复杂任务的深度分析**
   - 核心目标（一句话概括）
   - 关键需求列表（3-5个，SMART原则）
   - 技术挑战点（技术难度、实现风险）
   - 预期交付物（代码、文档、配置）
   - 复杂度评估（low/medium/high）

**输出格式**：
严格输出 JSON 格式（无 markdown 代码块）：

简单任务：
{
  "taskType": "simple-chat" | "simple-query",
  "needsOrchestration": false,
  "reason": "这是一个简单的XXX，不需要编排"
}

复杂任务：
{
  "taskType": "complex-task",
  "needsOrchestration": true,
  "reason": "这是一个复杂任务，需要多智能体协作",
  "analysis": {
    "coreObjective": "核心目标（一句话，明确、可量化）",
    "keyRequirements": ["需求1（具体、可验证）", "需求2", "需求3"],
    "technicalChallenges": ["挑战1（技术难点）", "挑战2"],
    "expectedDeliverables": ["交付物1（代码、文档、配置）", "交付物2"],
    "estimatedComplexity": "medium"
  }
}

**判断原则**：
- 涉及代码开发 → complex-task
- 需要多步骤 → complex-task
- 项目级任务 → complex-task
- 单句对话 → simple-chat
- 单个查询 → simple-query

请深入理解需求本质，不要被表面描述迷惑。`;
