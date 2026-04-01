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
import { eventBus } from '@main/common/eventbus';

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

    // 辅助函数：记录日志到 execution.logs（同时输出到控制台）
    const addLog = (level: 'info' | 'error' | 'warn', message: string): void => {
      execution.logs.push({
        timestamp: new Date().toISOString(),
        level,
        message
      });
      log[level](`[CronJobExecutor] [${job.name}] ${message}`);
    };

    try {
      addLog('info', `开始执行作业 (${job.source || 'dynamic'})`);

      let resultText: string;

      if (job.source === 'declarative') {
        resultText = await this.executeDeclarative(job, addLog);
      } else {
        resultText = await this.executeDynamic(job, addLog);
      }

      execution.status = 'success';
      execution.endedAt = new Date().toISOString();
      execution.result = resultText;

      await this.store.updateExecutionStatus(job.id, {
        lastRunAt: execution.startedAt,
        runCount: job.runCount + 1
      });

      addLog('info', `执行成功，耗时 ${Date.now() - new Date(execution.startedAt).getTime()}ms`);

      // ✅ 发送成功通知到前端（如果启用）
      if (job.sendNotification !== false) {
        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `定时任务「${job.name}」执行成功`,
          level: 'success',
          _timestamp: Date.now()
        });
      }
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

      addLog('error', `执行失败: ${errorMessage}`);

      // ❌ 发送失败通知到前端（如果启用）
      if (job.sendNotification !== false) {
        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `定时任务「${job.name}」执行失败：${errorMessage.slice(0, 100)}`,
          level: 'error',
          _timestamp: Date.now()
        });
      }

      if (job.failCount + 1 >= 3) {
        await this.store.update(job.id, {
          status: 'disabled',
          lastError: `连续失败 ${job.failCount + 1} 次，已自动禁用`
        });
        addLog('warn', `连续失败 ${job.failCount + 1} 次，已自动禁用`);

        // ⚠️ 发送禁用警告通知（重要警告，总是发送）
        eventBus.emit('agent:event', {
          _event: 'notify',
          message: `定时任务「${job.name}」连续失败 ${job.failCount + 1} 次，已自动禁用`,
          level: 'warning',
          _timestamp: Date.now()
        });
      }
    } finally {
      await this.store.saveExecution(execution);
      this.runningExecutions.delete(executionId);
    }
  }

  /**
   * 声明式 Job 执行：
   * - 如果指定了 agentId，则通过 Agent 执行（类似动态 Job）
   * - 否则直接调用 BaseCronJob.execute()
   */
  private async executeDeclarative(
    job: CronJobDefinition,
    addLog: (level: 'info' | 'error' | 'warn', message: string) => void
  ): Promise<string> {
    const instance = this.declarativeJobs.get(job.id);
    if (!instance) {
      throw new Error(`声明式 Job 实例未注册: ${job.id}`);
    }

    // 如果声明式 Job 指定了 agentId，则通过 Agent 执行
    if (instance.agentId) {
      addLog('info', `通过 Agent "${instance.agentId}" 执行`);
      // 构造包含任务描述的 job 对象传递给 executeDynamic
      const jobWithTask: CronJobDefinition = {
        ...job,
        task: instance.taskForAgent || job.description
      };
      return await this.executeDynamic(jobWithTask, addLog);
    }

    // 否则直接调用 execute 方法
    addLog('info', `直接执行声明式任务`);
    const result = await instance.execute({
      jobId: job.id,
      jobName: job.name,
      startTime: new Date()
    });

    // 解析结果，提取日志（如果有的话）
    addLog('info', `任务返回: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
    return result;
  }

  /**
   * 动态 Job 执行：通过 AgentExecutor 驱动 Agent
   */
  private async executeDynamic(
    job: CronJobDefinition,
    addLog: (level: 'info' | 'error' | 'warn', message: string) => void
  ): Promise<string> {
    const agentExecutor = getAgentExecutor();
    const sessionId = `cron-${job.id}-${Date.now()}`;
    const agentName = job.agentId || 'app-copilot';
    const builder = agentExecutor.piMono().name(agentName);

    addLog('info', `创建 Agent 会话: ${sessionId}`);
    addLog('info', `任务描述: ${job.task.slice(0, 100)}${job.task.length > 100 ? '...' : ''}`);

    const result = await agentExecutor.submitAndWait({
      sessionId,
      message: job.task,
      builder
    });

    addLog('info', `Agent 执行完成`);
    return result.output || '执行成功';
  }

  /**
   * 获取正在执行的作业
   */
  getRunningExecutions(): CronJobExecution[] {
    return Array.from(this.runningExecutions.values());
  }
}
