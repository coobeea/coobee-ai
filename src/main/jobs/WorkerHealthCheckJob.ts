/**
 * Worker 健康检查定时任务
 *
 * 每 10 分钟检查所有已注册 Worker 的运行状态，
 * 记录异常并生成简要报告。
 */

import { BaseCronJob, type CronJobContext } from '@main/ai/cron/types';
import { log } from '@main/common/logger';

export default class WorkerHealthCheckJob extends BaseCronJob {
  readonly name = 'worker-health-check';
  readonly description = '定期检查 Worker 健康状态';
  readonly cronExpression = '*/10 * * * *';

  async execute(ctx: CronJobContext): Promise<string> {
    log.info(`[${ctx.jobName}] 开始执行健康检查...`);

    try {
      const { WorkerManager } = await import('@main/common/worker/WorkerManager');
      const manager = WorkerManager.getInstance();
      const workers = manager.getAllWorkerInfo();

      const results: string[] = [];
      let hasIssue = false;

      for (const w of workers) {
        if (w.status === 'error' || w.status === 'stopped') {
          hasIssue = true;
          results.push(`⚠ ${w.name}: ${w.status}${w.error ? ` (${w.error})` : ''}`);
        } else {
          results.push(`✓ ${w.name}: ${w.status}`);
        }
      }

      const summary = hasIssue ? `部分 Worker 异常:\n${results.join('\n')}` : `所有 Worker 正常 (${results.length} 个)`;

      log.info(`[${ctx.jobName}] ${summary}`);
      return summary;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`[${ctx.jobName}] 健康检查失败: ${msg}`);
      throw error;
    }
  }
}
