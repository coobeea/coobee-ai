/**
 * Cron 子系统生命周期钩子
 *
 * 职责：
 * - 在 READY 阶段初始化 Cron 子系统
 * - 启动调度器
 * - 在 BEFORE_QUIT 阶段停止调度器
 */

import { log } from '@main/common/logger';
import { LifecyclePhase, type LifecycleHook } from '@main/common/types';
import { initializeCronSystem, getCronScheduler, getCronJobExecutor } from '@main/ai/cron';

export const CronSystemInitHook: LifecycleHook = {
  name: 'cron-system-init',
  phase: LifecyclePhase.READY,
  priority: 30, // 在 Gateway 之后
  critical: false,

  async execute() {
    try {
      log.info('[CronSystemHook] 初始化 Cron 子系统...');

      // 初始化存储和调度器
      await initializeCronSystem();

      // 注入 AgentExecutor 到 CronJobExecutor
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const executor = getCronJobExecutor();
      executor.setAgentExecutor(agentExecutor);

      // 启动调度器
      const scheduler = getCronScheduler();
      await scheduler.start();

      log.info('[CronSystemHook] Cron 子系统初始化完成');
    } catch (error) {
      log.error('[CronSystemHook] Cron 子系统初始化失败', error);
      throw error;
    }
  }
};

export const CronSystemCleanupHook: LifecycleHook = {
  name: 'cron-system-cleanup',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10,
  critical: false,

  async execute() {
    try {
      log.info('[CronSystemHook] 清理 Cron 子系统...');

      const scheduler = getCronScheduler();
      await scheduler.stop();

      log.info('[CronSystemHook] Cron 子系统清理完成');
    } catch (error) {
      log.error('[CronSystemHook] Cron 子系统清理失败', error);
      // 不抛出错误，避免阻塞退出流程
    }
  }
};
