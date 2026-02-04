export {
  CronJobConfig,
  CronJobOptions,
  JobExecutionResult,
  JobStatus,
  JobRuntimeInfo,
  JobExecutionContext,
  TaskResult
} from '../types'
export { BaseJob } from './BaseJob'
export {
  CronJobManager,
  type CronJobManagerConfig,
  DEFAULT_CRON_JOB_MANAGER_CONFIG
} from './CronJobManager'

import { log } from '../logger'
import { CronJobManager } from './CronJobManager'

export let cronJobManager: CronJobManager

export async function initialize(): Promise<void> {
  try {
    cronJobManager = CronJobManager.getInstance()
    await cronJobManager.initialize()
    log.info('[JobManager] Initialized')
  } catch (error) {
    log.warn('[JobManager] Failed to initialize:', error)
  }
}

export async function stop(): Promise<void> {
  if (cronJobManager) {
    await cronJobManager.stop()
    log.info('[JobManager] Stopped')
  }
}
