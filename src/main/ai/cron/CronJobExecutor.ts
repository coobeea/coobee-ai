/**
 * CronJobExecutor - Cron 作业执行器
 *
 * 支持两种执行路径：
 * 1. 动态 Job（source=dynamic）→ 通过 AgentExecutor 将 task 文本交给 Agent 处理
 * 2. 声明式 Job（source=declarative）→ 直接调用 BaseCronJob.execute() 方法
 *
 * AgentExecutor 通过 getAgentExecutor() 延迟获取，避免循环依赖。
 */

import { nanoid } from 'nanoid';
import { log } from '@main/common/logger';
import { getAgentExecutor } from '@main/ai/AgentExecutor';

import { CronJobStore } from './CronJobStore';
import type { CronJobDefinition, CronJobExecution } from './types';
import { BaseCronJob } from './types';

export class CronJobExecutor {
  private store: CronJobStore;
  private runningExecutions = new Map<string, CronJobExecution>();
  /** 声明式 Job 实例注册表（key = job.id） */
  private declarativeJobs = new Map<string, BaseCronJob>();

  constructor(store: CronJobStore) {
    this.store = store;
  }

  /**
   * 注册声明式 Job 实例（供 execute 时直接调用）
   */
  registerDeclarativeJob(job: BaseCronJob): void {
    this.declarativeJobs.set(job.id, job);
  }

  /**
   * 执行作业
   */
  async execute(job: CronJobDefinition): Promise<void> {
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
      log.info(`[CronJobExecutor] 开始执行作业: ${job.id} - ${job.name} (${job.source || 'dynamic'})`);

      let resultText: string;

      if (job.source === 'declarative') {
        resultText = await this.executeDeclarative(job);
      } else {
        resultText = await this.executeDynamic(job);
      }

      execution.status = 'success';
      execution.endedAt = new Date().toISOString();
      execution.result = resultText;

      await this.store.updateExecutionStatus(job.id, {
        lastRunAt: execution.startedAt,
        runCount: job.runCount + 1
      });

      log.info(`[CronJobExecutor] 作业执行成功: ${job.id}`);
    } catch (error) {
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

      if (job.failCount + 1 >= 3) {
        await this.store.update(job.id, {
          status: 'disabled',
          lastError: `连续失败 ${job.failCount + 1} 次，已自动禁用`
        });
        log.warn(`[CronJobExecutor] 作业 ${job.id} 连续失败 ${job.failCount + 1} 次，已自动禁用`);
      }
    } finally {
      await this.store.saveExecution(execution);
      this.runningExecutions.delete(executionId);
    }
  }

  /**
   * 声明式 Job 执行：直接调用 BaseCronJob.execute()
   */
  private async executeDeclarative(job: CronJobDefinition): Promise<string> {
    const instance = this.declarativeJobs.get(job.id);
    if (!instance) {
      throw new Error(`声明式 Job 实例未注册: ${job.id}`);
    }

    return await instance.execute({
      jobId: job.id,
      jobName: job.name,
      startTime: new Date()
    });
  }

  /**
   * 动态 Job 执行：通过 AgentExecutor 驱动 Agent
   */
  private async executeDynamic(job: CronJobDefinition): Promise<string> {
    const agentExecutor = getAgentExecutor();
    const sessionId = `cron-${job.id}-${Date.now()}`;
    const agentName = job.agentId || 'app-copilot';
    const builder = agentExecutor.piMono().name(agentName);

    const result = await agentExecutor.submitAndWait({
      sessionId,
      message: job.task,
      builder
    });

    return result.output || '执行成功';
  }

  /**
   * 获取正在执行的作业
   */
  getRunningExecutions(): CronJobExecution[] {
    return Array.from(this.runningExecutions.values());
  }
}
