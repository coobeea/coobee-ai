import { CronJobConfig, JobExecutionContext } from '../types'

export abstract class BaseJob {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly cron: string
  abstract readonly enabled: boolean

  abstract execute(context: JobExecutionContext): Promise<any>

  getJobConfig(): CronJobConfig {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      cron: this.cron,
      enabled: this.enabled
    }
  }
}
