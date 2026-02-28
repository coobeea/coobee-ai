/**
 * CronJobExecutor - Cron 作业执行器
 *
 * 职责：
 * - 执行 Cron 作业（调用 AgentExecutor）
 * - 记录执行日志
 * - 更新作业状态
 *
 * AgentExecutor 通过 getAgentExecutor() 延迟获取，避免循环依赖。
 */

import { nanoid } from 'nanoid';
import { log } from '@main/common/logger';
import { getAgentExecutor } from '@main/ai/AgentExecutor';

import { CronJobStore } from './CronJobStore';
import type { CronJobDefinition, CronJobExecution } from './types';

export class CronJobExecutor {
  private store: CronJobStore;
  private runningExecutions = new Map<string, CronJobExecution>();

  constructor(store: CronJobStore) {
    this.store = store;
  }

  /**
   * 执行作业
   */
  async execute(job: CronJobDefinition): Promise<void> {
    const agentExecutor = getAgentExecutor();

    const executionId = nanoid();
    const execution: CronJobExecution = {
      id: executionId,
      jobId: job.id,
      startedAt: new Date().toISOString(),
      status: 'running',
      logs: []
    };

    this.runningExecutions.set(executionId, execution);

    try {
      log.info(`[CronJobExecutor] 开始执行作业: ${job.id} - ${job.name}`);

      // 创建临时会话
      const sessionId = `cron-${job.id}-${Date.now()}`;

      // 构建执行请求（agentId 作为 PiMono Agent 的 name 标识）
      const builder = job.agentId ? agentExecutor.piMono().name(job.agentId) : agentExecutor.openai();

      // 执行任务（submitAndWait 为同步等待结果的公开 API）
      const result = await agentExecutor.submitAndWait({
        sessionId,
        message: job.task,
        builder
      });

      // 记录成功
      execution.status = 'success';
      execution.endedAt = new Date().toISOString();
      execution.result = result.output || '执行成功';

      await this.store.updateExecutionStatus(job.id, {
        lastRunAt: execution.startedAt,
        runCount: job.runCount + 1
      });

      log.info(`[CronJobExecutor] 作业执行成功: ${job.id}`);
    } catch (error) {
      // 记录失败
      const errorMessage = error instanceof Error ? error.message : String(error);

      execution.status = 'failed';
      execution.endedAt = new Date().toISOString();
      execution.error = errorMessage;

      await this.store.updateExecutionStatus(job.id, {
        lastRunAt: execution.startedAt,
        runCount: job.runCount + 1,
        failCount: job.failCount + 1,
        lastError: errorMessage
      });

      log.error(`[CronJobExecutor] 作业执行失败: ${job.id}`, error);

      // 如果连续失败超过 3 次，自动禁用作业
      if (job.failCount + 1 >= 3) {
        await this.store.update(job.id, {
          status: 'disabled',
          lastError: `连续失败 ${job.failCount + 1} 次，已自动禁用`
        });
        log.warn(`[CronJobExecutor] 作业 ${job.id} 连续失败 ${job.failCount + 1} 次，已自动禁用`);
      }
    } finally {
      // 保存执行记录
      await this.store.saveExecution(execution);
      this.runningExecutions.delete(executionId);
    }
  }

  /**
   * 获取正在执行的作业
   */
  getRunningExecutions(): CronJobExecution[] {
    return Array.from(this.runningExecutions.values());
  }
}
