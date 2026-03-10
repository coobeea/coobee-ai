/**
 * Agent 委托层
 *
 * 统一封装所有训练相关的 Agent 调用，提供：
 * - 统一的超时和重试机制
 * - 统一的错误处理
 * - 统一的日志记录
 * - JSON 解析容错
 */

import { ChannelRuntime } from '../channels/ChannelRuntime';
import type { TrainingTask, TrainingEvaluation, CoachAdvice, TrainingExecutorConfig } from './types';
import { log as logger } from '@main/common/logger';

export class AgentDelegator {
  private readonly config: TrainingExecutorConfig;

  constructor(config: TrainingExecutorConfig) {
    this.config = config;
  }

  // ==================== 执行训练任务 ====================

  /**
   * 通过被训练的 Agent 执行任务
   */
  async executeTask(agentId: string, task: TrainingTask): Promise<string> {
    logger.info(`[AgentDelegator] 执行任务: ${task.id} (智能体: ${agentId})`);

    const result = await this.callAgentWithRetry(
      agentId,
      task.description,
      { isTrainingExecution: true, taskId: task.id },
      'executeTask'
    );

    return result;
  }

  /**
   * 基于教练建议重新执行任务
   */
  async refineTask(agentId: string, task: TrainingTask, coachAdvice: CoachAdvice): Promise<string> {
    logger.info(`[AgentDelegator] 基于教练建议重新执行: ${task.id}`);

    const refinedPrompt = `
${task.description}

**改进建议**（请参考以下建议优化你的输出）：
${coachAdvice.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
    `.trim();

    const result = await this.callAgentWithRetry(
      agentId,
      refinedPrompt,
      { isTrainingRefinement: true, taskId: task.id },
      'refineTask'
    );

    return result;
  }

  // ==================== 评估 ====================

  /**
   * 通过评估 Agent 评估输出
   */
  async evaluateOutput(task: TrainingTask, output: string): Promise<TrainingEvaluation> {
    logger.info(`[AgentDelegator] 评估任务: ${task.id}`);

    const prompt = this.buildEvaluationPrompt(task, output);
    const result = await this.callAgentWithRetry(
      'training-evaluator',
      prompt,
      { isTrainingEvaluation: true, taskId: task.id },
      'evaluateOutput'
    );

    return this.parseEvaluation(result);
  }

  /**
   * 构建评估 Prompt
   */
  private buildEvaluationPrompt(task: TrainingTask, output: string): string {
    return `
评估以下训练任务的执行结果：

**任务 ID**：${task.id}

**任务描述**：
${task.description}

**任务难度**：${task.difficulty}/5

**智能体输出**：
${output}

${task.testCase ? `**测试用例**：\n${task.testCase}` : ''}

${task.expectedOutput ? `**期望输出**：\n${task.expectedOutput}` : ''}

请严格按照评估标准，给出 JSON 格式的评分。如果是代码任务，请使用 exec 工具实际运行测试。
    `.trim();
  }

  /**
   * 解析评估结果
   */
  private parseEvaluation(result: string): TrainingEvaluation {
    try {
      // 尝试提取 JSON（可能包含在 markdown 代码块中）
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到 JSON 格式的评估结果');
      }

      const evaluation = JSON.parse(jsonMatch[0]);

      // 验证必需字段
      if (typeof evaluation.score !== 'number') {
        throw new Error('评估结果缺少 score 字段');
      }

      // 补充默认字段
      return {
        score: evaluation.score,
        passed: evaluation.passed ?? evaluation.score >= 80,
        dimensions: evaluation.dimensions || {},
        feedback: evaluation.feedback || '无详细反馈',
        executionResult: evaluation.executionResult,
        evaluationTime: Date.now()
      };
    } catch (err) {
      logger.error('[AgentDelegator] 评估结果解析失败:', err);
      // 返回默认低分
      return {
        score: 40,
        passed: false,
        dimensions: {},
        feedback: `评估 Agent 输出格式错误: ${err instanceof Error ? err.message : String(err)}`,
        evaluationTime: Date.now()
      };
    }
  }

  // ==================== 训练教练 ====================

  /**
   * 通过训练教练获取改进建议
   */
  async getCoachAdvice(task: TrainingTask, output: string, evaluation: TrainingEvaluation): Promise<CoachAdvice> {
    logger.info(`[AgentDelegator] 获取教练建议: ${task.id} (得分: ${evaluation.score})`);

    const prompt = this.buildCoachPrompt(task, output, evaluation);
    const result = await this.callAgentWithRetry(
      'training-coach',
      prompt,
      { isTrainingCoach: true, taskId: task.id },
      'getCoachAdvice'
    );

    return this.parseCoachAdvice(result);
  }

  /**
   * 构建教练 Prompt
   */
  private buildCoachPrompt(task: TrainingTask, output: string, evaluation: TrainingEvaluation): string {
    return `
分析以下训练任务的表现，给出改进建议：

**任务描述**：
${task.description}

**智能体输出**：
${output}

**评估结果**：
- 总分：${evaluation.score}/100 ${evaluation.passed ? '✓ 达标' : '✗ 未达标'}
- 各维度得分：${JSON.stringify(evaluation.dimensions, null, 2)}
- 反馈：${evaluation.feedback}

请给出 3-5 条具体的改进建议（每行一条，用 - 开头）。
    `.trim();
  }

  /**
   * 解析教练建议
   */
  private parseCoachAdvice(result: string): CoachAdvice {
    // 提取所有以 - 或数字开头的行
    const lines = result.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('-') || /^\d+\./.test(trimmed);
    });

    const suggestions = lines.map((line) => {
      // 移除开头的 - 或数字
      return line.replace(/^[\s-]*(\d+\.)?\s*/, '').trim();
    });

    return {
      suggestions,
      priority: 1
    };
  }

  // ==================== 数据生成 ====================

  /**
   * 通过数据生成 Agent 生成新任务
   */
  async generateTask(
    baseDataset: TrainingTask[],
    context: {
      currentRound: number;
      avgScore: number;
      weakDimension?: string;
    }
  ): Promise<TrainingTask> {
    logger.info(`[AgentDelegator] 生成训练任务 (轮次: ${context.currentRound})`);

    const prompt = this.buildDataGenPrompt(baseDataset, context);
    const result = await this.callAgentWithRetry(
      'training-data-generator',
      prompt,
      { isTrainingDataGeneration: true, round: context.currentRound },
      'generateTask'
    );

    return this.parseTask(result);
  }

  /**
   * 构建数据生成 Prompt
   */
  private buildDataGenPrompt(
    baseDataset: TrainingTask[],
    context: { currentRound: number; avgScore: number; weakDimension?: string }
  ): string {
    // 选择 3 个示例任务
    const examples = baseDataset.slice(0, 3);

    // 根据平均分决定难度调整
    let difficultyHint = '';
    if (context.avgScore >= 85) {
      difficultyHint = '当前表现优秀，可以生成稍难的任务（difficulty + 1）';
    } else if (context.avgScore < 70) {
      difficultyHint = '当前表现不佳，生成稍简单的任务（difficulty - 1）';
    } else {
      difficultyHint = '保持当前难度';
    }

    return `
生成 1 个新的训练任务。

**基础数据集示例**：
${JSON.stringify(examples, null, 2)}

**当前训练进度**：
- 当前轮次：${context.currentRound}
- 近期平均分：${context.avgScore.toFixed(1)}
- 难度建议：${difficultyHint}
${context.weakDimension ? `- 弱点维度：${context.weakDimension}（生成针对该维度的任务）` : ''}

**生成要求**：
1. 与基础数据集保持一致的风格
2. 避免与已有任务重复
3. 任务描述清晰、具体
4. 包含可验证的测试用例

输出 JSON 格式的任务定义（严格遵循 TrainingTask 类型）。
    `.trim();
  }

  /**
   * 解析生成的任务
   */
  private parseTask(result: string): TrainingTask {
    try {
      // 提取 JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到 JSON 格式的任务定义');
      }

      const task = JSON.parse(jsonMatch[0]);

      // 验证必需字段
      if (!task.id || !task.description || !task.difficulty) {
        throw new Error('任务定义缺少必需字段（id, description, difficulty）');
      }

      // 补充元数据
      return {
        ...task,
        metadata: {
          ...task.metadata,
          isGenerated: true,
          generatedAt: Date.now()
        }
      };
    } catch (err) {
      logger.error('[AgentDelegator] 任务解析失败:', err);
      throw new Error(`数据生成 Agent 输出无效: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ==================== 统一 Agent 调用 ====================

  /**
   * 统一的 Agent 调用（带超时和重试）
   */
  private async callAgentWithRetry(
    agentId: string,
    userMessage: string,
    metadata: Record<string, unknown>,
    operation: string,
    retries = 0
  ): Promise<string> {
    try {
      const result = await this.callAgentWithTimeout(agentId, userMessage, metadata);
      logger.info(`[AgentDelegator] ${operation} 成功 (智能体: ${agentId})`);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (retries < this.config.maxRetries) {
        logger.warn(`[AgentDelegator] ${operation} 失败，重试 ${retries + 1}/${this.config.maxRetries}: ${errorMsg}`);
        // 指数退避
        await this.sleep(1000 * Math.pow(2, retries));
        return await this.callAgentWithRetry(agentId, userMessage, metadata, operation, retries + 1);
      }

      logger.error(`[AgentDelegator] ${operation} 最终失败:`, err);
      throw new Error(`Agent 调用失败（${operation}）: ${errorMsg}`);
    }
  }

  /**
   * 带超时的 Agent 调用
   */
  private async callAgentWithTimeout(
    agentId: string,
    userMessage: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Agent 调用超时')), this.config.agentTimeout)
    );

    const callPromise = ChannelRuntime.getInstance()
      .executeAgent({
        agentId,
        message: userMessage,
        sessionId: `training-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        context: {
          channel: 'training',
          ...metadata,
          isTrainingRelated: true,
          timestamp: Date.now()
        }
      })
      .then((result) => result.output || '');

    const result = await Promise.race([callPromise, timeoutPromise]);
    return result;
  }

  /**
   * 延迟工具
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
