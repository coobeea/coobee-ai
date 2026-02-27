import type { LLMService } from '@main/ai/provider/LLMService';
import { log } from '@main/common/logger';

export interface ValidationInput {
  /** 用户原始请求 */
  userRequest: string;

  /** 待验证的输出 */
  output: string;

  /** 验收标准（可选，如果不提供则由 LLM 推断） */
  acceptanceCriteria?: AcceptanceCriteria[];
}

export interface AcceptanceCriteria {
  /** 标准描述 */
  description: string;

  /** 标准类型 */
  type: 'quantifiable' | 'qualitative' | 'existence';

  /** 权重（1-10，默认 5） */
  weight?: number;
}

export interface ValidationResult {
  /** 是否通过验证 */
  passed: boolean;

  /** 总分（0-100） */
  overallScore: number;

  /** 各项标准评分 */
  criteriaScores: Array<{
    criterion: string;
    passed: boolean;
    score: number;
    reason: string;
  }>;

  /** 问题诊断 */
  issues: Array<{
    severity: 'critical' | 'major' | 'minor';
    description: string;
    suggestedFix: string;
  }>;

  /** 验证耗时（ms） */
  duration: number;
}

/**
 * Validator - 输出质量验证器
 *
 * 职责：
 * 1. 对照验收标准评估输出质量
 * 2. 打分（0-100）
 * 3. 诊断问题并提供修复建议
 */
export class Validator {
  constructor(private llmClient: LLMService) {}

  /**
   * 验证输出质量
   */
  async validate(input: ValidationInput): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      log.info('[Validator] 开始验证输出质量');

      const prompt = this.buildValidationPrompt(input);

      const response = await this.llmClient.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 3000
      });

      const llmOutput = response.content.trim();
      const parsed = this.parseLLMOutput(llmOutput);
      const duration = Date.now() - startTime;

      log.info(`[Validator] 验证完成，耗时 ${duration}ms，总分: ${parsed.overallScore}/100，通过: ${parsed.passed}`);

      return {
        ...parsed,
        duration
      };
    } catch (_error) {
      log.error('[Validator] 验证失败:', _error);

      return {
        passed: false,
        overallScore: 0,
        criteriaScores: [],
        issues: [
          {
            severity: 'critical',
            description: '验证过程失败，无法评估输出质量',
            suggestedFix: '请检查 Validator 配置和 LLM 连接'
          }
        ],
        duration: Date.now() - startTime
      };
    }
  }

  private buildValidationPrompt(input: ValidationInput): string {
    const criteriaSection = input.acceptanceCriteria
      ? `## 验收标准\n\n${input.acceptanceCriteria.map((c, i) => `${i + 1}. **${c.description}** (权重: ${c.weight || 5}/10)`).join('\n')}\n`
      : '## 验收标准\n\n请根据用户请求，推断合理的验收标准。\n';

    return `你是一个专业的输出质量评估专家。你的任务是对照验收标准，评估 Agent 输出的质量。

## 用户请求

${input.userRequest}

${criteriaSection}

## Agent 输出

${input.output}

## 评估任务

请从以下 4 个维度评估输出质量：

1. **完整性**（Completeness）: 是否完整回答了用户的请求？
2. **准确性**（Accuracy）: 内容是否准确、无错误？
3. **一致性**（Consistency）: 内容是否前后一致、逻辑连贯？
4. **可用性**（Usability）: 用户能否直接使用这个输出？

## 输出格式（JSON）

请严格按照以下 JSON 格式输出：

\`\`\`json
{
  "passed": true,
  "overallScore": 85,
  "criteriaScores": [
    {
      "criterion": "完整性",
      "passed": true,
      "score": 90,
      "reason": "完整回答了用户的所有问题"
    }
  ],
  "issues": []
}
\`\`\`

评分规则：
- 总分 = 各维度得分的加权平均
- 通过标准：总分 >= 70 分
- 得分 < 70 分表示需要修复`;
  }

  private parseLLMOutput(llmOutput: string): Omit<ValidationResult, 'duration'> {
    try {
      const jsonMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : llmOutput;
      const parsed = JSON.parse(jsonStr.trim());

      const score = typeof parsed.overallScore === 'number' ? parsed.overallScore : 50;
      return {
        passed: typeof parsed.passed === 'boolean' ? parsed.passed : score >= 70,
        overallScore: score,
        criteriaScores: parsed.criteriaScores || [],
        issues: parsed.issues || []
      };
    } catch (_error) {
      log.warn('[Validator] 无法解析 LLM 输出为 JSON，标记为未通过');

      return {
        passed: false,
        overallScore: 50,
        criteriaScores: [
          {
            criterion: '总体评估',
            passed: false,
            score: 50,
            reason: '无法解析验证结果，质量存疑'
          }
        ],
        issues: [
          {
            severity: 'major',
            description: '验证结果无法解析为有效 JSON',
            suggestedFix: '重试验证或检查 LLM 输出格式'
          }
        ]
      };
    }
  }
}
