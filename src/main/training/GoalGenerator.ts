/**
 * GoalGenerator - 训练目标生成器
 *
 * 职责：
 *   1. 接收用户口述的训练目标描述
 *   2. 调用具有 dimension-architect 技能的 Agent
 *   3. 生成完整的训练目标（含维度体系）
 *   4. 返回结构化的 TrainingGoal 对象
 */

import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import { log as logger } from '@main/common/logger';
import type { TrainingGoal, TrainingDimension } from './types';

export interface GoalGenerationInput {
  /** 智能体 ID */
  agentId: string;
  /** 技能包名称 */
  skillName: string;
  /** 用户口述的训练目标描述 */
  goalDescription: string;
}

export class GoalGenerator {
  private runtime: ChannelRuntime;

  constructor() {
    this.runtime = ChannelRuntime.getInstance();
  }

  /**
   * 生成训练目标
   *
   * @param input - 输入参数
   * @returns 完整的训练目标定义
   */
  async generate(input: GoalGenerationInput): Promise<TrainingGoal> {
    logger.info(`[GoalGenerator] 开始生成训练目标: ${input.goalDescription}`);

    try {
      // 1. 构建 Prompt（调用 dimension-architect 技能）
      const prompt = this.buildPrompt(input);

      // 2. 调用 dimension-architect Agent（假设我们有一个专门的 Agent）
      // TODO: 需要创建一个具有 dimension-architect 技能的 Agent
      // 目前先使用 app-copilot（如果它有该技能）
      const result = await this.runtime.executeAgent({
        agentId: 'app-copilot', // TODO: 应该是专门的 dimension-architect Agent
        sessionId: `goal-gen-${Date.now()}`,
        message: prompt,
        context: {
          channel: 'training',
          source: 'training',
          channelType: 'training',
          metadata: {
            agentId: input.agentId,
            skillName: input.skillName
          }
        }
      });

      if (result.error) {
        throw new Error(`调用 dimension-architect 失败: ${result.error}`);
      }

      // 3. 解析结果
      const goal = this.parseGoalFromResponse(result.output, input);

      logger.info(`[GoalGenerator] 训练目标生成成功: ${goal.name}`);
      return goal;
    } catch (error) {
      logger.error(`[GoalGenerator] 生成训练目标失败:`, error);
      throw error;
    }
  }

  /**
   * 构建 Prompt
   */
  private buildPrompt(input: GoalGenerationInput): string {
    return `
我需要为智能体训练生成一个评估目标和维度体系。

**训练场景**：
- 智能体：${input.agentId}
- 使用技能包：${input.skillName}
- 训练目标描述：${input.goalDescription}

**任务要求**：

请使用 dimension-architect 技能，分析这个训练目标，并生成完整的维度体系。

**输出格式**（JSON）：

\`\`\`json
{
  "name": "训练目标名称",
  "description": "训练目标的详细描述",
  "dimensions": [
    {
      "name": "dimension-id",
      "label": "维度显示名称",
      "description": "维度描述（这个维度衡量什么）",
      "weight": 30,
      "criteria": "评分标准（具体的判断标准）"
    }
  ],
  "threshold": 75
}
\`\`\`

**要求**：
1. 维度数量：3-5 个
2. 权重总和：100
3. 阈值（threshold）：建议 75（百分制）
4. 每个维度必须有明确的评分标准（criteria）

请直接输出 JSON，不要其他说明文字。
    `.trim();
  }

  /**
   * 从 Agent 响应中解析训练目标
   */
  private parseGoalFromResponse(response: string, input: GoalGenerationInput): TrainingGoal {
    try {
      // 1. 尝试提取 JSON（可能被包裹在 markdown 代码块中）
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('无法从响应中提取 JSON');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      // 2. 验证必需字段
      if (!parsed.name || !parsed.dimensions || !Array.isArray(parsed.dimensions)) {
        throw new Error('JSON 格式不正确：缺少必需字段');
      }

      // 3. 转换为 TrainingGoal 类型
      const dimensions: TrainingDimension[] = parsed.dimensions.map((dim: Record<string, unknown>) => ({
        name: dim.name || dim.id,
        label: dim.label || dim.name,
        description: dim.description || '',
        weight: dim.weight || 20,
        criteria: dim.criteria || ''
      }));

      // 4. 验证权重总和
      const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.1) {
        logger.warn(`[GoalGenerator] 权重总和不为 100: ${totalWeight}，自动归一化`);
        // 归一化权重
        dimensions.forEach((d) => {
          d.weight = Math.round((d.weight / totalWeight) * 100);
        });
      }

      const goal: TrainingGoal = {
        name: parsed.name,
        description: parsed.description || input.goalDescription,
        dimensions,
        threshold: parsed.threshold || 75,
        passingScore: parsed.threshold || 75 // 兼容旧字段
      };

      return goal;
    } catch (error) {
      logger.error(`[GoalGenerator] 解析响应失败:`, error);
      logger.debug(`[GoalGenerator] 原始响应:`, response);

      // 返回一个默认的训练目标（fallback）
      return this.createFallbackGoal(input);
    }
  }

  /**
   * 创建 Fallback 训练目标（当解析失败时）
   */
  private createFallbackGoal(input: GoalGenerationInput): TrainingGoal {
    logger.warn(`[GoalGenerator] 使用 Fallback 训练目标`);

    return {
      name: input.goalDescription,
      description: `训练 ${input.agentId} 使用 ${input.skillName} 技能包的能力`,
      dimensions: [
        {
          name: 'completeness',
          label: '完整性',
          description: '输出是否完整，包含所有必需内容',
          weight: 30,
          criteria: '包含所有必需的字段和章节'
        },
        {
          name: 'correctness',
          label: '正确性',
          description: '输出是否正确，符合技能包规则',
          weight: 30,
          criteria: '格式正确，逻辑合理'
        },
        {
          name: 'clarity',
          label: '清晰性',
          description: '输出是否清晰易懂',
          weight: 20,
          criteria: '表达清晰，结构合理'
        },
        {
          name: 'usefulness',
          label: '实用性',
          description: '输出是否实用，可直接使用',
          weight: 20,
          criteria: '具体可执行，有实际价值'
        }
      ],
      threshold: 75,
      passingScore: 75
    };
  }
}
