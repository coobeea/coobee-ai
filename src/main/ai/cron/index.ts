/**
 * Cron 子系统导出
 */

export type {
  CronJobDefinition,
  CronJobStatus,
  CronJobExecution,
  CronJobSource,
  CronJobContext,
  CreateCronJobParams,
  UpdateCronJobParams
} from './types';

export { BaseCronJob } from './types';

export { CronJobStore } from './CronJobStore';
export { CronScheduler } from './CronScheduler';
export { CronJobExecutor } from './CronJobExecutor';

// 单例实例
import { CronJobStore } from './CronJobStore';
import { CronJobExecutor } from './CronJobExecutor';
import { CronScheduler } from './CronScheduler';

let store: CronJobStore | null = null;
let executor: CronJobExecutor | null = null;
let scheduler: CronScheduler | null = null;

/**
 * 初始化 Cron 子系统
 */
export async function initializeCronSystem(): Promise<void> {
  if (store && executor && scheduler) {
    return; // 已初始化
  }

  store = new CronJobStore();
  await store.initialize();

  executor = new CronJobExecutor(store);
  scheduler = new CronScheduler(store, executor);
}

/**
 * 获取 CronJobStore 实例
 */
export function getCronJobStore(): CronJobStore {
  if (!store) {
    throw new Error('CronJobStore 未初始化，请先调用 initializeCronSystem()');
  }
  return store;
}

/**
 * 获取 CronScheduler 实例
 */
export function getCronScheduler(): CronScheduler {
  if (!scheduler) {
    throw new Error('CronScheduler 未初始化，请先调用 initializeCronSystem()');
  }
  return scheduler;
}

/**
 * 获取 CronJobExecutor 实例
 */
export function getCronJobExecutor(): CronJobExecutor {
  if (!executor) {
    throw new Error('CronJobExecutor 未初始化，请先调用 initializeCronSystem()');
  }
  return executor;
}
