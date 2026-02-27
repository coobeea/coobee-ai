import type { LLMService } from '@main/ai/provider/LLMService';
import { log } from '@main/common/logger';

export interface AggregationInput {
  /** 用户原始请求 */
  userRequest: string;

  /** 子任务结果列表 */
  subTaskResults: Array<{
    taskId: string;
    agentName: string;
    output: string;
    status: 'success' | 'failed';
    error?: string;
  }>;

  /** 协作上下文（如 Swarm 的 handoff 链路） */
  collaborationContext?: string;
}

export interface AggregationResult {
  /** 汇总的最终输出 */
  finalOutput: string;

  /** 结构化摘要 */
  summary: {
    completedTasks: string[];
    failedTasks: string[];
    keyFindings: string[];
    recommendations: string[];
  };

  /** 是否完整（所有子任务都成功） */
  isComplete: boolean;

  /** 汇总耗时（ms） */
  duration: number;
}

/**
 * Aggregator - 多 Agent 输出汇总器
 *
 * 职责：
 * 1. 整合多个子 Agent 的输出
 * 2. 去重和结构化
 * 3. 识别缺失部分
 */
export class Aggregator {
  constructor(private llmClient: LLMService) {}

  /**
   * 汇总多个子 Agent 的输出
   */
  async aggregate(input: AggregationInput): Promise<AggregationResult> {
    const startTime = Date.now();

    try {
      log.info(`[Aggregator] 开始汇总 ${input.subTaskResults.length} 个子任务结果`);

      const successResults = input.subTaskResults.filter((r) => r.status === 'success');
      const failedResults = input.subTaskResults.filter((r) => r.status === 'failed');

      // 构建 LLM 提示词
      const prompt = this.buildAggregationPrompt(input, successResults, failedResults);

      // 调用 LLM 进行智能汇总
      const response = await this.llmClient.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 4000
      });

      const llmOutput = response.content.trim();

      // 解析 LLM 输出（尝试提取 JSON）
      const parsed = this.parseLLMOutput(llmOutput);

      const duration = Date.now() - startTime;

      log.info(`[Aggregator] 汇总完成，耗时 ${duration}ms，完整性: ${parsed.isComplete}`);

      return {
        finalOutput: parsed.finalOutput,
        summary: parsed.summary,
        isComplete: failedResults.length === 0,
        duration
      };
    } catch (_error) {
      log.error('[Aggregator] 汇总失败:', _error);

      // Fallback：简单拼接
      const fallbackOutput = input.subTaskResults
        .filter((r) => r.status === 'success')
        .map((r) => r.output)
        .join('\n\n---\n\n');

      return {
        finalOutput:
          fallbackOutput ||
          '汇总失败，没有可用的子任务输出。\n\n' +
            input.subTaskResults
              .filter((r) => r.status === 'failed')
              .map((r) => `- ${r.agentName}: ${r.error || '执行失败'}`)
              .join('\n'),
        summary: {
          completedTasks: input.subTaskResults.filter((r) => r.status === 'success').map((r) => r.agentName),
          failedTasks: input.subTaskResults
            .filter((r) => r.status === 'failed')
            .map((r) => `${r.agentName}: ${r.error || '未知错误'}`),
          keyFindings: [],
          recommendations: ['汇总过程出现错误，请检查日志']
        },
        isComplete: false,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 构建汇总提示词
   */
  private buildAggregationPrompt(
    input: AggregationInput,
    successResults: AggregationInput['subTaskResults'],
    failedResults: AggregationInput['subTaskResults']
  ): string {
    return `你是一个多 Agent 协作的汇总器。你的任务是将多个专家 Agent 的输出整合为一个连贯的、高质量的最终答案。

## 用户原始请求

${input.userRequest}

${input.collaborationContext ? `## 协作上下文\n\n${input.collaborationContext}\n` : ''}

## 子任务执行结果

### 成功完成的任务（${successResults.length} 个）

${successResults.map((r, i) => `#### 子任务 ${i + 1}: ${r.agentName}\n\n${r.output}`).join('\n\n---\n\n')}

${failedResults.length > 0 ? `### 失败的任务（${failedResults.length} 个）\n\n${failedResults.map((r) => `- ${r.agentName}: ${r.error || '执行失败'}`).join('\n')}` : ''}

## 你的任务

1. **整合**: 将所有成功的输出整合为一个连贯的答案
2. **去重**: 去除重复信息，保持简洁
3. **补全**: 如果有失败的子任务，说明缺失的部分
4. **结构化**: 使用清晰的 Markdown 格式组织内容

## 输出格式（JSON）

请严格按照以下 JSON 格式输出，不要添加任何其他内容：

\`\`\`json
{
  "finalOutput": "最终汇总的输出（Markdown 格式，应该是一个完整的、连贯的答案）",
  "summary": {
    "completedTasks": ["任务1的简短描述", "任务2的简短描述"],
    "failedTasks": ["任务3的简短描述及失败原因"],
    "keyFindings": ["关键发现1", "关键发现2"],
    "recommendations": ["建议1", "建议2"]
  }
}
\`\`\`

注意：
- finalOutput 应该是面向用户的最终答案，语言流畅、结构清晰
- summary 用于内部分析，简洁扼要
- 如果所有子任务都失败，finalOutput 应说明情况并提供可行的后续步骤`;
  }

  /**
   * 解析 LLM 输出
   */
  private parseLLMOutput(llmOutput: string): {
    finalOutput: string;
    summary: AggregationResult['summary'];
    isComplete: boolean;
  } {
    try {
      // 尝试提取 JSON（可能被包裹在 ```json ``` 中）
      const jsonMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : llmOutput;

      const parsed = JSON.parse(jsonStr.trim());

      return {
        finalOutput: parsed.finalOutput || llmOutput,
        summary: parsed.summary || {
          completedTasks: [],
          failedTasks: [],
          keyFindings: [],
          recommendations: []
        },
        isComplete: (parsed.summary?.failedTasks?.length || 0) === 0
      };
    } catch (_error) {
      log.warn('[Aggregator] 无法解析 LLM 输出为 JSON，使用原始输出');

      // Fallback：使用原始 LLM 输出
      return {
        finalOutput: llmOutput,
        summary: {
          completedTasks: [],
          failedTasks: [],
          keyFindings: [],
          recommendations: []
        },
        isComplete: true
      };
    }
  }
}
