/**
 * 并行训练执行器 - Phase 2
 *
 * 核心特性：
 * - 同时执行多个训练任务（N=3-5）
 * - 动态任务队列（完成一个补充一个）
 * - 结果顺序保证（按轮次排序后存储）
 * - 并发控制（防止资源耗尽）
 */

import { TrainingExecutor } from './TrainingExecutor';
import type { TrainingSession, TrainingTask, TrainingRoundResult, CoachAdvice, TrainingEvaluation } from './types';
import { log as logger } from '@main/common/logger';

export class ParallelTrainingExecutor extends TrainingExecutor {
  /**
   * 执行并行训练流程
   */
  async executeTraining(session: TrainingSession): Promise<void> {
    const sessionId = session.id;
    const parallelCount = session.parallelCount || 3;

    logger.info(`[ParallelTraining] 开始并行训练: ${sessionId}, 并发数=${parallelCount}, 总轮次=${session.maxRounds}`);

    try {
      // 标记为运行中
      session.status = 'running';
      await this.sessionStore.save(session);
      this.emitProgress(session);

      // 创建任务队列
      const taskQueue: { round: number; task: TrainingTask }[] = [];
      for (let round = 1; round <= session.maxRounds; round++) {
        const task = await this.getTask(session, round);
        taskQueue.push({ round, task });
      }

      // 并行执行
      const results: TrainingRoundResult[] = [];
      const runningTasks: Promise<TrainingRoundResult>[] = [];

      while (taskQueue.length > 0 || runningTasks.length > 0) {
        // 检查暂停/停止标记
        if (this.pauseFlags.get(sessionId) || this.stopFlags.get(sessionId)) {
          logger.info(`[ParallelTraining] 训练已${this.pauseFlags.get(sessionId) ? '暂停' : '停止'}: ${sessionId}`);
          session.status = this.pauseFlags.get(sessionId) ? 'paused' : 'completed';
          if (this.pauseFlags.get(sessionId)) {
            session.progress.pausedAt = Date.now();
          } else {
            session.endTime = Date.now();
          }
          await this.sessionStore.save(session);
          this.emitProgress(session);
          return;
        }

        // 补充任务到达并发上限
        while (taskQueue.length > 0 && runningTasks.length < parallelCount) {
          const { round, task } = taskQueue.shift()!;
          const taskPromise = this.executeRoundWithTask(session, round, task);
          runningTasks.push(taskPromise);
          logger.debug(`[ParallelTraining] 启动任务: 第 ${round} 轮`);
        }

        // 等待任意一个任务完成
        const result = await Promise.race(runningTasks);
        const index = runningTasks.findIndex((p) => p === Promise.resolve(result));
        runningTasks.splice(index, 1);

        // 记录结果
        results.push(result);

        // 按轮次排序
        results.sort((a, b) => a.round - b.round);
        session.results = results;

        // 更新进度
        session.progress.completedRounds = results.length;
        session.progress.passedRounds = results.filter((r) => r.evaluation.passed).length;
        await this.sessionStore.updateProgress(sessionId, session.progress);
        this.emitProgress(session);

        logger.info(
          `[ParallelTraining] 第 ${result.round}/${session.maxRounds} 轮完成: ${result.evaluation.score}分 ${result.evaluation.passed ? '✓' : '✗'}`
        );

        // 检查提前终止
        if (this.shouldEarlyStop(session)) {
          logger.info(`[ParallelTraining] 连续达标，提前结束`);
          break;
        }
      }

      // 训练完成
      session.status = 'completed';
      session.endTime = Date.now();
      await this.sessionStore.save(session);
      await this.generateReport(session);

      logger.info(`[ParallelTraining] 训练完成: ${sessionId}`);
      this.emitProgress(session);
    } catch (err) {
      logger.error(`[ParallelTraining] 训练失败: ${sessionId}`, err);
      session.status = 'failed';
      session.endTime = Date.now();
      await this.sessionStore.save(session);
      this.emitProgress(session);
      throw err;
    } finally {
      this.runningSessions.delete(sessionId);
      this.pauseFlags.delete(sessionId);
      this.stopFlags.delete(sessionId);
    }
  }

  /**
   * 执行单轮训练（带任务参数）- 并行训练专用
   */
  private async executeRoundWithTask(
    session: TrainingSession,
    round: number,
    task: TrainingTask
  ): Promise<TrainingRoundResult> {
    const startTime = Date.now();

    // 1. 执行任务
    logger.debug(`[ParallelTraining] 执行任务: ${task.id}`);
    let output = await this.delegator.executeTask(session.agentId, task);

    // 2. 评估结果
    logger.debug(`[ParallelTraining] 评估任务: ${task.id}`);
    let evaluation = await this.delegator.evaluateOutput(task, output);

    // 3. 如果未达标且启用教练，获取建议并重试
    let usedCoachAdvice = false;
    let coachAdvice: CoachAdvice | undefined = undefined;
    let refinedOutput: string | undefined = undefined;
    let refinedEvaluation: TrainingEvaluation | undefined = undefined;

    if (!evaluation.passed && this.config.enableCoach) {
      logger.debug(`[ParallelTraining] 任务未达标 (${evaluation.score}分)，获取教练建议`);

      coachAdvice = await this.delegator.getCoachAdvice(task, output, evaluation);
      usedCoachAdvice = true;

      logger.debug(`[ParallelTraining] 基于教练建议重新执行`);
      refinedOutput = await this.delegator.refineTask(session.agentId, task, coachAdvice);
      refinedEvaluation = await this.delegator.evaluateOutput(task, refinedOutput);

      logger.info(
        `[ParallelTraining] 改进效果: ${evaluation.score} → ${refinedEvaluation.score} (${refinedEvaluation.passed ? '✓ 达标' : '✗ 仍未达标'})`
      );

      // 使用改进后的结果
      output = refinedOutput;
      evaluation = refinedEvaluation;
    }

    const endTime = Date.now();

    return {
      round,
      taskId: task.id,
      taskDescription: task.description,
      taskDifficulty: task.difficulty,
      output,
      evaluation,
      usedCoachAdvice,
      coachAdvice,
      refinedOutput,
      refinedEvaluation,
      startTime,
      endTime,
      duration: endTime - startTime
    };
  }
}
