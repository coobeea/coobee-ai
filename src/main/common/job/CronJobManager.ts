import cron, { type ScheduledTask } from 'node-cron'

import { log } from '../logger'
import {
  CronJobConfig,
  JobExecutionContext,
  JobExecutionResult,
  JobRuntimeInfo,
  JobStatus
} from '../types'
import { BaseJob } from './BaseJob'

export interface CronJobManagerConfig {
  enabled?: boolean
  defaultTimezone?: string
}

export const DEFAULT_CRON_JOB_MANAGER_CONFIG: Required<CronJobManagerConfig> = {
  enabled: true,
  defaultTimezone: 'Asia/Shanghai'
}

export class CronJobManager {
  private static instance: CronJobManager
  private jobs = new Map<string, { job: BaseJob; runtimeInfo: JobRuntimeInfo }>()
  private tasks = new Map<string, ScheduledTask>()
  private config: Required<CronJobManagerConfig>

  private constructor(config: CronJobManagerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? DEFAULT_CRON_JOB_MANAGER_CONFIG.enabled,
      defaultTimezone: config.defaultTimezone ?? DEFAULT_CRON_JOB_MANAGER_CONFIG.defaultTimezone
    }
  }

  static getInstance(config?: CronJobManagerConfig): CronJobManager {
    if (!CronJobManager.instance) {
      CronJobManager.instance = new CronJobManager(config)
    }
    return CronJobManager.instance
  }

  async initialize(): Promise<void> {
    this.startAll()
    log.info('[CronJobManager] Initialized')
  }

  register(job: BaseJob, config?: Partial<CronJobConfig>): void {
    const jobConfig = {
      ...job.getJobConfig(),
      ...config
    }

    if (this.jobs.has(jobConfig.id)) {
      log.warn(`[CronJobManager] Job ${jobConfig.id} already exists, overwriting`)
      this.unregister(jobConfig.id)
    }

    if (!cron.validate(jobConfig.cron)) {
      throw new Error(`Invalid cron expression: ${jobConfig.cron}`)
    }

    const runtimeInfo: JobRuntimeInfo = {
      config: {
        ...jobConfig,
        options: {
          timezone: this.config.defaultTimezone,
          timeout: 30000,
          runOnInit: false,
          ...jobConfig.options
        }
      },
      status: jobConfig.enabled ? JobStatus.IDLE : JobStatus.DISABLED,
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0
    }

    this.jobs.set(jobConfig.id, { job, runtimeInfo })

    if (jobConfig.enabled && this.config.enabled) {
      this.scheduleJob(jobConfig.id)
    }

    log.info(
      `[CronJobManager] Registered job: ${job.name} (${jobConfig.id}) with cron: ${jobConfig.cron}`
    )
  }

  private scheduleJob(jobId: string): void {
    const jobData = this.jobs.get(jobId)
    if (!jobData) return

    const { runtimeInfo } = jobData
    const { config } = runtimeInfo

    const task = cron.schedule(
      config.cron,
      async () => {
        await this.executeJob(jobId)
      },
      {
        timezone: config.options?.timezone
      }
    )

    this.tasks.set(jobId, task)
    task.start()

    log.debug(`[CronJobManager] Scheduled job: ${jobData.job.name} (${jobId})`)
  }

  private async executeJob(jobId: string): Promise<void> {
    const jobData = this.jobs.get(jobId)
    if (!jobData || jobData.runtimeInfo.status === JobStatus.RUNNING) return

    const { job, runtimeInfo } = jobData
    const startTime = Date.now()
    runtimeInfo.status = JobStatus.RUNNING
    runtimeInfo.totalRuns++

    const context: JobExecutionContext = {
      jobId,
      jobName: runtimeInfo.config.name,
      startTime,
      data: runtimeInfo.config.data,
      cancelled: false,
      retryCount: 0
    }

    let result: JobExecutionResult

    try {
      const data = await this.executeWithTimeout(job, context, runtimeInfo.config.options?.timeout)

      const endTime = Date.now()
      result = {
        jobId,
        startTime,
        endTime,
        duration: endTime - startTime,
        success: true,
        data
      }

      runtimeInfo.status = JobStatus.SUCCESS
      runtimeInfo.successRuns++
    } catch (error) {
      const endTime = Date.now()
      const errorMessage = error instanceof Error ? error.message : String(error)

      result = {
        jobId,
        startTime,
        endTime,
        duration: endTime - startTime,
        success: false,
        error: errorMessage
      }

      runtimeInfo.status = JobStatus.FAILED
      runtimeInfo.failedRuns++

      log.error(`[CronJobManager] Job ${jobId} failed:`, error)
    }

    runtimeInfo.lastRun = new Date()
    runtimeInfo.lastResult = result

    if (runtimeInfo.config.enabled) {
      runtimeInfo.status = JobStatus.IDLE
    }
  }

  private async executeWithTimeout(
    job: BaseJob,
    context: JobExecutionContext,
    timeout?: number
  ): Promise<unknown> {
    if (!timeout) {
      return await job.execute(context)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        context.cancelled = true
        reject(new Error(`Job execution timeout after ${timeout}ms`))
      }, timeout)

      job
        .execute(context)
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  unregister(jobId: string): boolean {
    const task = this.tasks.get(jobId)
    if (task) {
      task.stop()
      task.destroy()
      this.tasks.delete(jobId)
    }

    const removed = this.jobs.delete(jobId)
    if (removed) {
      log.info(`[CronJobManager] Unregistered job: ${jobId}`)
    }

    return removed
  }

  stopAll(): void {
    for (const [jobId, task] of this.tasks) {
      task.stop()
      const jobData = this.jobs.get(jobId)
      if (jobData) {
        jobData.runtimeInfo.status = JobStatus.DISABLED
      }
    }
    log.info('[CronJobManager] All jobs stopped')
  }

  startAll(): void {
    if (!this.config.enabled) return

    for (const [jobId, jobData] of this.jobs) {
      if (jobData.runtimeInfo.config.enabled) {
        const task = this.tasks.get(jobId)
        if (task) {
          task.start()
          jobData.runtimeInfo.status = JobStatus.IDLE
        }
      }
    }
    log.info('[CronJobManager] All enabled jobs started')
  }

  stop(): void {
    this.stopAll()
    this.tasks.clear()
    this.jobs.clear()
    log.info('[CronJobManager] Manager stopped')
  }

  getJobInfo(jobId: string): JobRuntimeInfo | undefined {
    return this.jobs.get(jobId)?.runtimeInfo
  }

  getAllJobs(): JobRuntimeInfo[] {
    return Array.from(this.jobs.values()).map((data) => data.runtimeInfo)
  }
}
