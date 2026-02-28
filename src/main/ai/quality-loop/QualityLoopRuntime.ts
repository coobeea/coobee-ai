/**
 * QualityLoopRuntime — 质量循环运行模式
 *
 * 独立的第四种多智能体运行模式，封装完整的 **执行→验证→修复** 闭环。
 *
 * 流程：
 *   1. 主 Agent 执行用户请求（完整 agent 模式，带工具和技能）
 *   2. Validator 独立评估输出质量（辩证验证——全新上下文）
 *   3. 若未通过，Repairer 生成修复策略
 *   4. 修复 Agent 按策略修复输出
 *   5. 循环 2-4，最多 N 轮
 *
 * 与嵌入式质量闭环的区别：
 *   - 执行阶段使用完整 Agent（带工具、技能），而非 llmService.chat()
 *   - 修复阶段也使用完整 Agent
 *   - 作为独立运行模式，可单独使用或与 swarm/orchestrator 组合
 */

import { AbstractAgentRuntime, createRuntimeLogger, generateRuntimeId } from '../runtime/AbstractAgentRuntime';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk } from '../runtime/types';
import type { SessionInfo } from '../runtime/types';
import { getLLMService } from '../provider/LLMService';
import { Validator, type AcceptanceCriteria, type ValidationResult } from './Validator';
import { Repairer } from './Repairer';

const log = createRuntimeLogger('QualityLoopRuntime');

// ==================== 配置 ====================

export interface QualityLoopConfig {
  sessionId: string;
  agentExecutor: AgentExecutorLike;
  maxIterations?: number;
  passThreshold?: number;
  acceptanceCriteria?: AcceptanceCriteria[];
}

/** AgentExecutor 的最小接口（避免循环依赖） */
interface AgentExecutorLike {
  stream(request: {
    sessionId: string;
    message: string;
    builder?: unknown;
  }): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;
  piMono(): { name(n: string): { mode(m: string): { lightweight(l: boolean): unknown } } };
}

// ==================== Runtime ====================

export class QualityLoopRuntime extends AbstractAgentRuntime {
  readonly type = 'quality-loop' as const;
  readonly id: string;
  readonly supportsHITL = false;

  private _name: string;
  private _interrupted = false;
  private _sessionId: string;
  private _agentExecutor: AgentExecutorLike;
  private _maxIterations: number;
  private _passThreshold: number;
  private _acceptanceCriteria?: AcceptanceCriteria[];

  readonly options: AgentRuntimeOptions;

  constructor(config: QualityLoopConfig) {
    super();
    this.id = generateRuntimeId('quality-loop');
    this._name = 'Quality Loop';
    this._sessionId = config.sessionId;
    this._agentExecutor = config.agentExecutor;
    this._maxIterations = config.maxIterations ?? 3;
    this._passThreshold = config.passThreshold ?? 70;
    this._acceptanceCriteria = config.acceptanceCriteria;
    this.options = { name: this._name, instructions: '' };
  }

  get name(): string {
    return this._name;
  }

  get interrupted(): boolean {
    return this._interrupted;
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    log.info(`Initialized: maxIterations=${this._maxIterations}, passThreshold=${this._passThreshold}`);
  }

  async destroy(): Promise<void> {
    log.info('Destroyed');
  }

  // ========== 核心流式方法 ==========

  protected async *doStream(
    input: string,
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now();

    yield { type: 'run:start', content: 'Quality Loop started' };

    // ── Step 1: 主 Agent 执行 ──
    log.info('Step 1: Executing main agent...');
    yield { type: 'text:delta', content: '**[质量循环]** 执行阶段...\n\n' };

    let currentOutput = '';
    try {
      const executorSessionId = `${this._sessionId}:ql-executor`;
      const builder = this._agentExecutor.piMono().name('ql-executor').mode('agent').lightweight(false);

      const gen = this._agentExecutor.stream({
        sessionId: executorSessionId,
        message: input,
        builder
      });

      for (let r = await gen.next(); !r.done; r = await gen.next()) {
        const chunk = r.value;
        // 透传主 Agent 的所有流式事件
        yield chunk;
        if (chunk.type === 'text:delta' && chunk.content) {
          currentOutput += chunk.content;
        }
      }
    } catch (error) {
      log.error('Main agent execution failed:', error);
      yield {
        type: 'run:error',
        content: `主 Agent 执行失败: ${error instanceof Error ? error.message : String(error)}`
      };
      return {
        output: '',
        metadata: { qualityLoop: { passed: false, reason: 'execution_failed' } }
      };
    }

    if (!currentOutput.trim()) {
      yield { type: 'quality:done', content: '主 Agent 无输出', data: { finalScore: 0, rounds: 0, passed: false } };
      return {
        output: '',
        metadata: { qualityLoop: { passed: false, reason: 'empty_output' } }
      };
    }

    // ── Step 2-4: 验证→修复循环 ──
    const llmService = getLLMService();
    const validator = new Validator(llmService);
    const repairer = new Repairer(llmService);

    let finalScore = 0;
    let passed = false;
    let round = 0;

    for (round = 1; round <= this._maxIterations; round++) {
      // ── 验证 ──
      yield {
        type: 'quality:round_start',
        content: `验证轮次 ${round}/${this._maxIterations}`,
        data: { round, maxRounds: this._maxIterations }
      };

      yield { type: 'quality:validating', content: '正在验证输出质量...' };
      log.info(`Round ${round}: Validating output (${currentOutput.length} chars)...`);

      let validation: ValidationResult;
      try {
        validation = await validator.validate({
          userRequest: input,
          output: currentOutput,
          acceptanceCriteria: this._acceptanceCriteria
        });
      } catch (error) {
        log.error(`Round ${round}: Validation failed:`, error);
        validation = {
          passed: false,
          overallScore: 0,
          criteriaScores: [],
          issues: [{ severity: 'critical', description: '验证过程异常', suggestedFix: '重试' }],
          duration: 0
        };
      }

      finalScore = validation.overallScore;
      passed = validation.overallScore >= this._passThreshold;

      yield {
        type: 'quality:score',
        content: `评分: ${validation.overallScore}/100 (${passed ? '通过' : '未通过'})`,
        data: {
          score: validation.overallScore,
          passed,
          issues: validation.issues.map((i) => ({ severity: i.severity, description: i.description }))
        }
      };

      if (passed) {
        log.info(`Round ${round}: Passed with score ${validation.overallScore}`);
        break;
      }

      // ── 修复计划 ──
      log.info(`Round ${round}: Score ${validation.overallScore} < ${this._passThreshold}, generating repair plan...`);

      const repairPlan = await repairer.generateRepairPlan({
        userRequest: input,
        currentOutput,
        validationResult: validation,
        repairRound: round
      });

      if (!repairPlan.shouldRepair || repairPlan.strategy === 'abort') {
        log.info(`Round ${round}: Repair aborted (strategy=${repairPlan.strategy})`);
        yield {
          type: 'quality:repairing',
          content: `修复中止: ${repairPlan.rootCause}`,
          data: { strategy: repairPlan.strategy, rootCause: repairPlan.rootCause }
        };
        break;
      }

      yield {
        type: 'quality:repairing',
        content: `修复策略: ${repairPlan.strategy}`,
        data: { strategy: repairPlan.strategy, rootCause: repairPlan.rootCause }
      };

      // ── 执行修复 ──
      log.info(`Round ${round}: Applying repair (strategy=${repairPlan.strategy})...`);
      yield { type: 'text:delta', content: `\n\n**[质量循环]** 修复轮 ${round}: ${repairPlan.strategy}...\n\n` };

      try {
        const repairMessage = this.buildRepairPrompt(input, currentOutput, validation, repairPlan.repairInstructions);

        const repairResponse = await llmService.chat({
          messages: [{ role: 'user', content: repairMessage }],
          temperature: 0.5,
          maxTokens: 4000
        });

        if (repairResponse.content.trim()) {
          currentOutput = repairResponse.content.trim();
          yield { type: 'text:delta', content: currentOutput };
        }
      } catch (error) {
        log.error(`Round ${round}: Repair execution failed:`, error);
        break;
      }
    }

    // ── 完成 ──
    const duration = Date.now() - startTime;
    yield {
      type: 'quality:done',
      content: `质量循环完成: ${finalScore}/100, ${round} 轮, ${passed ? '通过' : '未通过'}`,
      data: { finalScore, rounds: round, passed }
    };
    yield { type: 'run:done', content: '' };

    log.info(`Done: score=${finalScore}, rounds=${round}, passed=${passed}, duration=${duration}ms`);

    return {
      output: currentOutput,
      metadata: {
        qualityLoop: {
          finalScore,
          rounds: round,
          passed,
          maxIterations: this._maxIterations,
          passThreshold: this._passThreshold,
          duration
        }
      }
    };
  }

  // ========== 会话管理（最小实现） ==========

  async getSession(): Promise<SessionInfo> {
    return {
      sessionId: this._sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0
    };
  }

  async clearSession(): Promise<void> {
    // QualityLoopRuntime 不持有会话状态
  }

  // ========== HITL（不支持） ==========

  async resumeWithApproval(): Promise<AsyncGenerator<StreamChunk, ExecutionResult, unknown>> {
    throw new Error('QualityLoopRuntime does not support HITL');
  }

  async resumeWithRejection(): Promise<AsyncGenerator<StreamChunk, ExecutionResult, unknown>> {
    throw new Error('QualityLoopRuntime does not support HITL');
  }

  // ========== 私有方法 ==========

  private buildRepairPrompt(
    userRequest: string,
    currentOutput: string,
    validation: ValidationResult,
    repairInstructions: string
  ): string {
    const issueList = validation.issues.map((i) => `- [${i.severity}] ${i.description} → ${i.suggestedFix}`).join('\n');

    return `你需要修复以下输出，使其通过质量验证。

## 原始用户请求

${userRequest}

## 当前输出（未通过验证，评分 ${validation.overallScore}/100）

${currentOutput}

## 验证发现的问题

${issueList || '无具体问题描述'}

## 修复指令

${repairInstructions}

## 要求

请直接输出修复后的完整结果，不要添加额外解释。确保修复所有已知问题。`;
  }
}
