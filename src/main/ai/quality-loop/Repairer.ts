import type { LLMChatFn, ChatMessage } from './llm-chat';
import { log } from '@main/common/logger';
import type { ValidationResult } from './Validator';

export interface RepairInput {
  /** 用户原始请求 */
  userRequest: string;

  /** 当前输出（未通过验证的） */
  currentOutput: string;

  /** 验证结果 */
  validationResult: ValidationResult;

  /** 修复轮次（用于记录） */
  repairRound: number;
}

export interface RepairPlan {
  /** 是否建议修复 */
  shouldRepair: boolean;

  /** 修复策略 */
  strategy: 'regenerate' | 'patch' | 'replan' | 'abort';

  /** 修复指令（给 Agent 的指导） */
  repairInstructions: string;

  /** 问题根因分析 */
  rootCause: string;

  /** 预期改进点 */
  expectedImprovements: string[];

  /** 生成耗时（ms） */
  duration: number;
}

/**
 * Repairer - 输出修复器
 *
 * 职责：
 * 1. 分析验证失败的原因
 * 2. 生成修复计划
 * 3. 提供修复指令
 */
export class Repairer {
  constructor(private llmChat: LLMChatFn) {}

  /**
   * 生成修复计划
   */
  async generateRepairPlan(input: RepairInput): Promise<RepairPlan> {
    const startTime = Date.now();

    try {
      log.info(`[Repairer] 开始生成修复计划（第 ${input.repairRound} 轮）`);

      // 如果分数太低（< 50），建议重新规划而非修补
      if (input.validationResult.overallScore < 50) {
        log.warn(`[Repairer] 输出质量过低（${input.validationResult.overallScore}分），建议重新规划`);

        return {
          shouldRepair: true,
          strategy: 'replan',
          repairInstructions: this.buildReplanInstructions(input),
          rootCause: '输出质量过低，可能是任务分解或执行策略有问题',
          expectedImprovements: ['重新分析用户需求', '优化任务分解策略', '调整 Agent 协作模式'],
          duration: Date.now() - startTime
        };
      }

      // 如果修复轮次过多（>= 3），建议中止
      if (input.repairRound >= 3) {
        log.warn(`[Repairer] 修复轮次过多（${input.repairRound}），建议中止`);

        return {
          shouldRepair: false,
          strategy: 'abort',
          repairInstructions: '已达到最大修复次数，建议人工介入',
          rootCause: '多次修复未能达标，可能存在系统性问题',
          expectedImprovements: [],
          duration: Date.now() - startTime
        };
      }

      // 如果只有轻微问题（score >= 80），建议修补
      if (input.validationResult.overallScore >= 80) {
        log.info(`[Repairer] 输出质量较高（${input.validationResult.overallScore}分），建议修补`);

        return {
          shouldRepair: true,
          strategy: 'patch',
          repairInstructions: this.buildPatchInstructions(input),
          rootCause: '输出基本符合要求，但存在轻微问题',
          expectedImprovements: input.validationResult.issues.map((issue) => issue.suggestedFix),
          duration: Date.now() - startTime
        };
      }

      // 中等质量（50-80 分），建议重新生成
      log.info(`[Repairer] 输出质量中等（${input.validationResult.overallScore}分），建议重新生成`);

      const prompt = this.buildRepairPrompt(input);

      const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
      const llmOutput = (await this.llmChat({ messages, temperature: 0.3, maxTokens: 2000 })).trim();

      return {
        shouldRepair: true,
        strategy: 'regenerate',
        repairInstructions: llmOutput,
        rootCause: this.extractRootCause(input.validationResult),
        expectedImprovements: input.validationResult.issues.map((issue) => issue.suggestedFix),
        duration: Date.now() - startTime
      };
    } catch (error) {
      log.error(`[Repairer] 修复计划生成失败:`, error);

      // Fallback：简单修补
      return {
        shouldRepair: true,
        strategy: 'patch',
        repairInstructions: '请优化输出，使其更完整、准确、易用。',
        rootCause: '修复计划生成失败',
        expectedImprovements: ['提升输出质量'],
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 构建修复提示词
   */
  private buildRepairPrompt(input: RepairInput): string {
    const issuesText = input.validationResult.issues
      .map(
        (issue, i) =>
          `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}\n   建议修复: ${issue.suggestedFix}`
      )
      .join('\n\n');

    const failedCriteria = input.validationResult.criteriaScores
      .filter((c) => !c.passed)
      .map((c) => `- ${c.criterion}: ${c.reason} (得分: ${c.score}/100)`)
      .join('\n');

    return `你是一个输出修复专家。你的任务是分析验证失败的输出，并提供详细的修复指令。

## 用户原始请求

${input.userRequest}

## 当前输出（未通过验证）

${input.currentOutput}

## 验证结果

- **总分**: ${input.validationResult.overallScore}/100（未通过，需要 >= 70 分）
- **修复轮次**: 第 ${input.repairRound} 轮

### 未通过的标准

${failedCriteria || '所有标准都通过，但总分仍然偏低'}

### 发现的问题

${issuesText}

## 你的任务

请提供详细的修复指令，指导 Agent 如何改进输出。修复指令应该：

1. **具体明确**: 不要说"优化内容"，而要说"在第 2 段补充具体的数据支持"
2. **可操作**: 每条指令都应该是可执行的动作
3. **有优先级**: 先解决 critical 问题，再解决 major，最后是 minor

## 输出格式（纯文本）

直接输出修复指令，不要 JSON 格式。例如：

---
修复指令（第 ${input.repairRound} 轮）：

1. 完整性问题：在第 3 段补充关于"XXX"的具体说明，因为用户明确要求了这部分内容。

2. 准确性问题：修正第 5 段中的技术错误，"XXX" 应该是 "YYY"。

3. 一致性问题：统一术语使用，前面用了"XXX"，后面用了"YYY"，应该统一为"XXX"。

4. 可用性问题：在末尾添加"下一步行动"章节，明确告诉用户如何使用这个输出。

注意：修复时保持输出的整体结构，只改进问题部分，不要全部重写。
---`;
  }

  /**
   * 构建重新规划指令
   */
  private buildReplanInstructions(input: RepairInput): string {
    const criticalIssues = input.validationResult.issues
      .filter((issue) => issue.severity === 'critical')
      .map((issue) => `- ${issue.description}`)
      .join('\n');

    return `当前输出质量过低（${input.validationResult.overallScore}/100），建议重新规划：

致命问题：
${criticalIssues || '- 整体质量不达标'}

建议行动：
1. 重新分析用户需求，确保理解正确
2. 重新分解任务，优化任务粒度和依赖关系
3. 重新分配 Agent，选择更合适的专家
4. 调整协作模式（Swarm/Orchestrator/单 Agent）

请从头开始，重新执行任务。`;
  }

  /**
   * 构建修补指令
   */
  private buildPatchInstructions(input: RepairInput): string {
    const minorIssues = input.validationResult.issues
      .map((issue, i) => `${i + 1}. ${issue.description}\n   修复建议: ${issue.suggestedFix}`)
      .join('\n\n');

    return `当前输出质量较高（${input.validationResult.overallScore}/100），只需要修补轻微问题：

${minorIssues}

注意：
- 保持输出的整体结构和内容
- 只修复上述问题点
- 不要做大幅改动`;
  }

  /**
   * 提取问题根因
   */
  private extractRootCause(validationResult: ValidationResult): string {
    const criticalIssues = validationResult.issues.filter((issue) => issue.severity === 'critical');

    if (criticalIssues.length > 0) {
      return criticalIssues.map((issue) => issue.description).join('; ');
    }

    const majorIssues = validationResult.issues.filter((issue) => issue.severity === 'major');

    if (majorIssues.length > 0) {
      return majorIssues.map((issue) => issue.description).join('; ');
    }

    const failedCriteria = validationResult.criteriaScores.filter((c) => !c.passed).map((c) => c.criterion);

    if (failedCriteria.length > 0) {
      return `以下标准未通过: ${failedCriteria.join(', ')}`;
    }

    return '输出质量不达标，但具体原因不明确';
  }
}
