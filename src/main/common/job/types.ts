export interface CronJobConfig {
  id: string
  name: string
  description?: string
  cron: string
  enabled: boolean
  data?: any
  options?: CronJobOptions
}

export interface CronJobOptions {
  timezone?: string
  maxRetries?: number
  retryDelay?: number
  timeout?: number
  runOnInit?: boolean
}

export interface JobExecutionResult {
  jobId: string
  startTime: number
  endTime: number
  duration: number
  success: boolean
  data?: any
  error?: string
  retryCount?: number
}

export enum JobStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  DISABLED = 'disabled'
}

export interface JobRuntimeInfo {
  config: CronJobConfig
  status: JobStatus
  nextRun?: Date
  lastRun?: Date
  lastResult?: JobExecutionResult
  totalRuns: number
  successRuns: number
  failedRuns: number
}

export interface JobExecutionContext {
  jobId: string
  jobName: string
  startTime: number
  data?: any
  cancelled: boolean
  retryCount: number
}

export interface TaskResult {
  taskId: string
  success: boolean
  data?: any
  error?: string
  duration: number
  completedAt: number
}
