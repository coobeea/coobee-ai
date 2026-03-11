/**
 * 训练执行器 - 基础版
 *
 * 负责：
 * - 执行训练循环
 * - 协调 Agent 调用（任务执行、评估、教练）
 * - 管理训练进度
 * - 生成训练报告
 */

import { AgentDelegator } from './AgentDelegator';
import { TrainingSessionStore } from './TrainingSessionStore';
import { TestSetValidator } from './TestSetValidator';
import { TrainingVersionManager } from './TrainingVersionManager';
import type {
  TrainingSession,
  TrainingTask,
  TrainingRoundResult,
  TrainingExecutorConfig,
  TrainingReport,
  CoachAdvice,
  TrainingEvaluation
} from './types';
import { DEFAULT_TRAINING_CONFIG } from './types';
import { log as logger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Env } from '@main/common/env';

export class TrainingExecutor {
  protected readonly delegator: AgentDelegator;
  protected readonly sessionStore: TrainingSessionStore;
  protected readonly config: TrainingExecutorConfig;
  protected readonly testSetValidator: TestSetValidator;
  protected readonly versionManager: TrainingVersionManager;

  /** 运行中的训练会话 Map */
  protected readonly runningSessions = new Map<string, TrainingSession>();

  /** 暂停标记 Map */
  protected readonly pauseFlags = new Map<string, boolean>();

  /** 停止标记 Map */
  protected readonly stopFlags = new Map<string, boolean>();

  constructor(sessionStore: TrainingSessionStore, config: TrainingExecutorConfig = DEFAULT_TRAINING_CONFIG) {
    this.sessionStore = sessionStore;
    this.config = config;
    this.delegator = new AgentDelegator(config);
    this.testSetValidator = new TestSetValidator(this.delegator);
    this.versionManager = new TrainingVersionManager();
  }

  // ==================== 训练执行 ====================

  /**
   * 执行完整训练流程（串行）
   */
  async executeTraining(session: TrainingSession): Promise<void> {
    const sessionId = session.id;
    logger.info(
      `[Training] 开始训练: ${sessionId}, 智能体=${session.agentId}, 目标=${session.goal.name}, 轮次=${session.maxRounds}`
    );

    try {
      // 标记为运行中
      this.runningSessions.set(sessionId, session);
      session.status = 'running';
      await this.sessionStore.save(session);
      this.emitProgress(session);

      // 主训练循环
      for (let round = 1; round <= session.maxRounds; round++) {
        // 检查暂停标记
        if (this.pauseFlags.get(sessionId)) {
          logger.info(`[Training] 训练已暂停: ${sessionId}`);
          session.status = 'paused';
          session.progress.pausedAt = Date.now();
          await this.sessionStore.save(session);
          this.emitProgress(session);
          return;
        }

        // 检查停止标记
        if (this.stopFlags.get(sessionId)) {
          logger.info(`[Training] 训练已停止: ${sessionId}`);
          session.status = 'completed';
          session.endTime = Date.now();
          await this.sessionStore.save(session);
          this.emitProgress(session);
          return;
        }

        // 执行单轮训练
        const result = await this.executeRound(session, round);

        // 记录结果
        session.results.push(result);
        session.progress.currentRound = round;
        session.progress.completedRounds = round;
        if (result.evaluation.passed) {
          session.progress.passedRounds++;
        }

        // 更新进度（每轮都保存，防止崩溃丢失）
        await this.sessionStore.updateProgress(sessionId, session.progress);
        this.emitProgress(session);

        // 日志
        logger.info(
          `[Training] 第 ${round}/${session.maxRounds} 轮完成: ${result.evaluation.score}分 ${result.evaluation.passed ? '✓' : '✗'}`
        );

        // 检查提前终止
        if (this.shouldEarlyStop(session)) {
          logger.info(`[Training] 连续 ${this.config.earlyStopThreshold} 轮达标，提前结束训练`);
          break;
        }
      }

      // 训练完成
      session.status = 'completed';
      session.endTime = Date.now();
      await this.sessionStore.save(session);

      // 测试集验证（如果启用）
      if (this.config.enableTestSet) {
        logger.info('[Training] 开始测试集验证');
        const validation = await this.testSetValidator.validate(session);
        logger.info(`[Training] 测试集验证完成: ${validation.isOverfitting ? '⚠️ 检测到过拟合' : '✓ 泛化能力正常'}`);
      }

      // 生成报告
      await this.generateReport(session);

      // 自动创建训练版本（如果启用）
      if (this.config.autoCreateVersion || session.metadata?.autoCreateVersion) {
        try {
          const versionId = await this.versionManager.createTrainedVersion(session);
          session.trainedVersionId = versionId;
          await this.sessionStore.save(session);
          logger.info(`[Training] 已创建训练版本: ${versionId}`);
        } catch (err) {
          logger.error(`[Training] 创建训练版本失败:`, err);
        }
      }

      logger.info(`[Training] 训练完成: ${sessionId}`);
      this.emitProgress(session);
    } catch (err) {
      logger.error(`[Training] 训练失败: ${sessionId}`, err);
      session.status = 'failed';
      session.endTime = Date.now();
      await this.sessionStore.save(session);
      this.emitProgress(session);
      throw err;
    } finally {
      // 清理标记
      this.runningSessions.delete(sessionId);
      this.pauseFlags.delete(sessionId);
      this.stopFlags.delete(sessionId);
    }
  }

  /**
   * 执行单轮训练（支持最多 3 次尝试）
   */
  private async executeRound(session: TrainingSession, round: number): Promise<TrainingRoundResult> {
    const startTime = Date.now();
    const maxAttempts = 3;

    // 1. 获取任务（从数据集选择或生成）
    const task = await this.getTask(session, round);

    // 记录所有尝试
    const attempts: Array<{
      attemptNo: number;
      output: string;
      evaluation: TrainingEvaluation;
      coachAdvice?: CoachAdvice;
    }> = [];

    let finalOutput = '';
    let finalEvaluation: TrainingEvaluation | null = null;
    let usedCoachAdvice = false;
    let coachAdvice: CoachAdvice | undefined = undefined;
    let refinedOutput: string | undefined = undefined;
    let refinedEvaluation: TrainingEvaluation | undefined = undefined;

    // 2. 最多尝试 3 次
    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
      logger.debug(`[Training] 执行任务 ${task.id}，尝试 ${attemptNo}/${maxAttempts}`);

      // 执行任务
      let output: string;
      if (attemptNo === 1) {
        // 第 1 次尝试：直接执行
        output = await this.delegator.executeTask(session.agentId, task);
      } else {
        // 第 2-3 次尝试：基于教练建议重新执行
        if (!coachAdvice) {
          logger.warn(`[Training] 尝试 ${attemptNo} 但没有教练建议，跳过`);
          break;
        }
        output = await this.delegator.refineTask(session.agentId, task, coachAdvice);
        usedCoachAdvice = true;
      }

      // 评估结果
      logger.debug(`[Training] 评估任务 ${task.id}，尝试 ${attemptNo}`);
      const evaluation = await this.delegator.evaluateOutput(task, output);

      // 记录本次尝试
      attempts.push({
        attemptNo,
        output,
        evaluation,
        coachAdvice: attemptNo > 1 ? coachAdvice : undefined
      });

      // 更新最终结果和改进后的结果
      finalOutput = output;
      finalEvaluation = evaluation;
      if (attemptNo > 1) {
        refinedOutput = output;
        refinedEvaluation = evaluation;
      }

      logger.info(
        `[Training] 尝试 ${attemptNo}/${maxAttempts}: ${evaluation.score}分 ${evaluation.passed ? '✓ 达标' : '✗ 未达标'}`
      );

      // 如果达标，结束尝试
      if (evaluation.passed) {
        logger.info(`[Training] 任务 ${task.id} 在第 ${attemptNo} 次尝试中达标`);
        break;
      }

      // 如果未达标且还有尝试机会，获取教练建议
      if (attemptNo < maxAttempts && this.config.enableCoach) {
        logger.debug(
          `[Training] 任务未达标 (${evaluation.score}分)，获取教练建议 (尝试 ${attemptNo + 1}/${maxAttempts})`
        );
        coachAdvice = await this.delegator.getCoachAdvice(task, output, evaluation);
      } else if (attemptNo === maxAttempts) {
        logger.warn(`[Training] 任务 ${task.id} 已达最大尝试次数 (${maxAttempts})，仍未达标`);
      }
    }

    // 确保有最终评估结果
    if (!finalEvaluation) {
      throw new Error(`[Training] 任务 ${task.id} 没有评估结果`);
    }

    const endTime = Date.now();

    return {
      round,
      taskId: task.id,
      taskDescription: task.description,
      taskDifficulty: task.difficulty,
      output: finalOutput,
      evaluation: finalEvaluation,
      usedCoachAdvice,
      coachAdvice,
      refinedOutput,
      refinedEvaluation,
      startTime,
      endTime,
      duration: endTime - startTime,
      // 新增：记录所有尝试
      attempts: attempts.map((a) => ({
        attemptNo: a.attemptNo,
        score: a.evaluation.score,
        passed: a.evaluation.passed
      })),
      totalAttempts: attempts.length
    };
  }

  /**
   * 获取训练任务（从数据集或生成）
   */
  protected async getTask(session: TrainingSession, round: number): Promise<TrainingTask> {
    const trainSet = session.dataset.trainSet;

    // 如果还在训练集范围内，直接选择
    if (round <= trainSet.length) {
      return trainSet[round - 1];
    }

    // 训练集用完，循环使用（对于基础版）
    const index = (round - 1) % trainSet.length;
    logger.debug(`[Training] 训练集循环使用: 第 ${round} 轮 → 任务 ${index + 1}`);
    return trainSet[index];

    // TODO: Phase 4 - 实现完全自动数据生成
    // const context = {
    //   currentRound: round,
    //   avgScore: this.calculateAvgScore(session.results),
    //   weakDimension: this.findWeakestDimension(session.results)
    // };
    // return await this.delegator.generateTask(trainSet, context);
  }

  /**
   * 检查是否应该提前终止
   */
  protected shouldEarlyStop(session: TrainingSession): boolean {
    const threshold = this.config.earlyStopThreshold;
    const recentResults = session.results.slice(-threshold);

    if (recentResults.length < threshold) {
      return false;
    }

    return recentResults.every((r) => r.evaluation.passed);
  }

  // ==================== 训练控制 ====================

  /**
   * 暂停训练
   */
  async pause(sessionId: string): Promise<void> {
    logger.info(`[Training] 暂停训练: ${sessionId}`);
    this.pauseFlags.set(sessionId, true);
  }

  /**
   * 恢复训练
   */
  async resume(sessionId: string): Promise<void> {
    logger.info(`[Training] 恢复训练: ${sessionId}`);

    const session = await this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`训练会话不存在: ${sessionId}`);
    }

    if (session.status !== 'paused') {
      throw new Error(`只能恢复已暂停的训练（当前状态: ${session.status}）`);
    }

    // 清除暂停标记
    this.pauseFlags.delete(sessionId);
    session.progress.pausedAt = undefined;

    // 从当前轮次继续
    await this.executeTraining(session);
  }

  /**
   * 停止训练
   */
  async stop(sessionId: string): Promise<void> {
    logger.info(`[Training] 停止训练: ${sessionId}`);
    this.stopFlags.set(sessionId, true);
  }

  // ==================== 报告生成 ====================

  /**
   * 生成训练报告
   */
  protected async generateReport(session: TrainingSession): Promise<void> {
    logger.info(`[Training] 生成训练报告: ${session.id}`);

    // 1. 计算统计数据
    let report = this.buildReport(session);

    // 2. 添加测试集验证数据（如果启用）
    if (this.config.enableTestSet && session.dataset.testSet && session.dataset.testSet.length > 0) {
      try {
        const validation = await this.testSetValidator.validate(session);
        report = this.testSetValidator.updateReportWithValidation(report, validation);
      } catch (err) {
        logger.error('[Training] 测试集验证失败:', err);
      }
    }

    // 3. 生成 Markdown
    const markdown = this.formatReportAsMarkdown(report);

    // 4. 保存到 Agent Home
    const agentHome = Env.getAgentHomeDir(session.agentId);
    const reportDir = path.join(agentHome, 'training-history');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `${session.id}.md`);
    fs.writeFileSync(reportPath, markdown, 'utf-8');

    logger.info(`[Training] 报告已保存: ${reportPath}`);

    // 5. 触发事件
    eventBus.emit('training:completed', {
      sessionId: session.id,
      agentId: session.agentId,
      reportPath
    });
  }

  /**
   * 构建报告数据
   */
  protected buildReport(session: TrainingSession): TrainingReport {
    const results = session.results;
    const totalRounds = results.length;
    const passedRounds = results.filter((r) => r.evaluation.passed).length;
    const scores = results.map((r) => r.evaluation.score);

    const finalScore = scores[scores.length - 1] || 0;
    const avgScore = scores.reduce((a, b) => a + b, 0) / totalRounds;
    const initialScore = scores[0] || 0;

    // 维度分析
    const dimensionAnalysis = this.analyzeDimensions(session);

    // 难度分析
    const difficultyAnalysis = this.analyzeDifficulty(session);

    // 训练曲线
    const trainingCurve = results.map((r) => ({
      round: r.round,
      score: r.evaluation.score,
      passed: r.evaluation.passed
    }));

    // 测试集验证（如果启用）
    const testSetValidation = undefined;
    // TODO: Phase 2 - 实现测试集验证

    // 弱点分析
    const weaknessAnalysis = this.analyzeWeakness(session);

    return {
      sessionId: session.id,
      agentId: session.agentId,
      goalName: session.goal.name,
      summary: {
        totalRounds,
        passedRounds,
        passRate: (passedRounds / totalRounds) * 100,
        finalScore,
        avgScore,
        initialScore,
        improvement: finalScore - initialScore,
        totalTimeMinutes: (session.endTime! - session.startTime) / 1000 / 60
      },
      dimensionAnalysis,
      difficultyAnalysis,
      trainingCurve,
      testSetValidation,
      weaknessAnalysis,
      generatedAt: Date.now()
    };
  }

  /**
   * 维度分析
   */
  protected analyzeDimensions(session: TrainingSession): TrainingReport['dimensionAnalysis'] {
    const dimensionScores: Record<string, number[]> = {};

    // 收集各维度得分
    for (const result of session.results) {
      for (const [dim, score] of Object.entries(result.evaluation.dimensions || {})) {
        if (!dimensionScores[dim]) {
          dimensionScores[dim] = [];
        }
        dimensionScores[dim].push(score);
      }
    }

    // 计算统计
    return Object.entries(dimensionScores).map(([dimension, scores]) => {
      const initialScore = scores[0] || 0;
      const finalScore = scores[scores.length - 1] || 0;
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      return {
        dimension,
        initialScore,
        finalScore,
        avgScore,
        improvement: finalScore - initialScore
      };
    });
  }

  /**
   * 难度分析
   */
  protected analyzeDifficulty(session: TrainingSession): TrainingReport['difficultyAnalysis'] {
    const difficultyGroups: Record<number, TrainingRoundResult[]> = {};

    // 按难度分组
    for (const result of session.results) {
      const diff = result.taskDifficulty;
      if (!difficultyGroups[diff]) {
        difficultyGroups[diff] = [];
      }
      difficultyGroups[diff].push(result);
    }

    // 计算统计
    return Object.entries(difficultyGroups).map(([difficulty, results]) => {
      const scores = results.map((r) => r.evaluation.score);
      const passedCount = results.filter((r) => r.evaluation.passed).length;

      return {
        difficulty: parseInt(difficulty),
        count: results.length,
        avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
        passRate: (passedCount / results.length) * 100
      };
    });
  }

  /**
   * 弱点分析
   */
  protected analyzeWeakness(session: TrainingSession): TrainingReport['weaknessAnalysis'] {
    const dimensionScores: Record<string, number[]> = {};

    for (const result of session.results) {
      for (const [dim, score] of Object.entries(result.evaluation.dimensions || {})) {
        if (!dimensionScores[dim]) {
          dimensionScores[dim] = [];
        }
        dimensionScores[dim].push(score);
      }
    }

    const weaknesses: TrainingReport['weaknessAnalysis'] = [];

    for (const [dimension, scores] of Object.entries(dimensionScores)) {
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const failureCount = scores.filter((s) => s < 80).length;

      // 平均分 < 75 视为弱点
      if (avgScore < 75) {
        weaknesses.push({
          dimension,
          avgScore,
          failureCount
        });
      }
    }

    // 按平均分排序（从低到高）
    return weaknesses.sort((a, b) => a.avgScore - b.avgScore);
  }

  /**
   * 格式化报告为 Markdown
   */
  protected formatReportAsMarkdown(report: TrainingReport): string {
    const summary = report.summary;

    const md = `# 训练报告

## 基本信息

- **训练会话 ID**: ${report.sessionId}
- **智能体**: ${report.agentId}
- **训练目标**: ${report.goalName}
- **训练轮次**: ${summary.totalRounds}
- **总耗时**: ${summary.totalTimeMinutes.toFixed(1)} 分钟
- **生成时间**: ${new Date(report.generatedAt).toLocaleString()}

---

## 训练结果

### 总体表现

- **最终得分**: ${summary.finalScore}/100
- **平均得分**: ${summary.avgScore.toFixed(1)}/100
- **初始得分**: ${summary.initialScore}/100
- **得分提升**: ${summary.improvement > 0 ? '+' : ''}${summary.improvement.toFixed(1)}
- **达标率**: ${summary.passRate.toFixed(1)}% (${summary.passedRounds}/${summary.totalRounds})

### 评价

${this.getPerformanceLevel(summary.finalScore, summary.improvement)}

---

## 维度分析

${report.dimensionAnalysis
  .map(
    (d) => `
### ${d.dimension}

- 初始得分: ${d.initialScore.toFixed(1)}
- 最终得分: ${d.finalScore.toFixed(1)}
- 平均得分: ${d.avgScore.toFixed(1)}
- 提升幅度: ${d.improvement > 0 ? '+' : ''}${d.improvement.toFixed(1)}
`
  )
  .join('\n')}

---

## 难度分析

| 难度 | 任务数 | 平均得分 | 达标率 |
|-----|-------|---------|--------|
${report.difficultyAnalysis.map((d) => `| ${d.difficulty} | ${d.count} | ${d.avgScore.toFixed(1)} | ${d.passRate.toFixed(1)}% |`).join('\n')}

---

## 弱点分析

${
  report.weaknessAnalysis && report.weaknessAnalysis.length > 0
    ? `
识别出以下弱点维度（平均分 < 75）：

${report.weaknessAnalysis.map((w) => `- **${w.dimension}**: 平均 ${w.avgScore.toFixed(1)}分，失败 ${w.failureCount} 次`).join('\n')}

**建议**：考虑针对这些弱点进行增量训练。
`
    : '✓ 未发现明显弱点'
}

---

## 训练曲线

\`\`\`
轮次 | 得分 | 状态
${report.trainingCurve.map((c) => `${c.round.toString().padStart(4)} | ${c.score.toString().padStart(3)} | ${c.passed ? '✓' : '✗'}`).join('\n')}
\`\`\`

---

## 详细记录

${report.trainingCurve.map((c) => `- 第 ${c.round} 轮: ${c.score}分 ${c.passed ? '✓' : '✗'}`).join('\n')}
`;

    return md;
  }

  /**
   * 获取表现等级评价
   */
  protected getPerformanceLevel(finalScore: number, improvement: number): string {
    if (finalScore >= 90) {
      return '🎉 **优秀**：训练效果显著，智能体表现优异！';
    } else if (finalScore >= 80) {
      return '✅ **良好**：训练目标已达成，智能体表现合格。';
    } else if (finalScore >= 70) {
      return '⚠️ **及格**：基本达标，但仍有提升空间，建议继续训练。';
    } else if (improvement > 10) {
      return '📈 **进步中**：虽未达标，但进步明显，建议继续训练。';
    } else {
      return '❌ **不及格**：未达标且进步不明显，建议检查训练数据和 Agent 配置。';
    }
  }

  // ==================== 事件通知 ====================

  /**
   * 触发进度更新事件
   */
  protected emitProgress(session: TrainingSession): void {
    eventBus.emit('training:progress', {
      sessionId: session.id,
      agentId: session.agentId,
      status: session.status,
      currentRound: session.progress.currentRound,
      totalRounds: session.progress.totalRounds,
      currentScore: session.progress.currentScore,
      avgScore: session.progress.avgScore,
      passedRounds: session.progress.passedRounds
    });
  }
}
