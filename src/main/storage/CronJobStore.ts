/**
 * CronJobStore — 定时任务文件存储
 *
 * 存储在 .home/cron-jobs/ 目录下，每个任务一个 JSON 文件
 * 文件名格式: {id}.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { nanoid } from 'nanoid';
import type { CronJob, CreateCronJobParams, UpdateCronJobParams } from '@shared/types/cron';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';

const CRON_DIR = path.join(Env.paths.userHome, 'cron-jobs');

/**
 * 确保 cron-jobs 目录存在
 */
async function ensureCronDir(): Promise<void> {
  try {
    await fs.mkdir(CRON_DIR, { recursive: true });
  } catch (err) {
    log.error('[CronJobStore] 创建目录失败:', err);
    throw err;
  }
}

/**
 * 生成 Snowflake ID
 */
function generateId(): string {
  return Date.now().toString() + nanoid(8);
}

/**
 * 获取任务文件路径
 */
function getJobPath(id: string): string {
  return path.join(CRON_DIR, `${id}.json`);
}

/**
 * 创建定时任务
 */
export async function createCronJob(params: CreateCronJobParams): Promise<CronJob> {
  await ensureCronDir();

  const now = new Date().toISOString();
  const job: CronJob = {
    id: generateId(),
    name: params.name,
    description: params.description,
    cronExpression: params.cronExpression,
    agentId: params.agentId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    runCount: 0
  };

  const filePath = getJobPath(job.id);
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');

  log.info('[CronJobStore] 创建任务:', job.id, job.name);
  return job;
}

/**
 * 获取所有定时任务
 */
export async function getAllCronJobs(): Promise<CronJob[]> {
  await ensureCronDir();

  try {
    const files = await fs.readdir(CRON_DIR);
    const jobs: CronJob[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(CRON_DIR, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const job = JSON.parse(content) as CronJob;
          jobs.push(job);
        } catch (err) {
          log.warn('[CronJobStore] 读取任务文件失败:', file, err);
        }
      }
    }

    // 按创建时间降序排列
    return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    log.error('[CronJobStore] 读取任务列表失败:', err);
    return [];
  }
}

/**
 * 获取单个定时任务
 */
export async function getCronJob(id: string): Promise<CronJob | null> {
  try {
    const filePath = getJobPath(id);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as CronJob;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    log.error('[CronJobStore] 读取任务失败:', id, err);
    throw err;
  }
}

/**
 * 更新定时任务
 */
export async function updateCronJob(id: string, updates: UpdateCronJobParams): Promise<CronJob | null> {
  const job = await getCronJob(id);
  if (!job) return null;

  const updatedJob: CronJob = {
    ...job,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  const filePath = getJobPath(id);
  await fs.writeFile(filePath, JSON.stringify(updatedJob, null, 2), 'utf-8');

  log.info('[CronJobStore] 更新任务:', id);
  return updatedJob;
}

/**
 * 删除定时任务
 */
export async function deleteCronJob(id: string): Promise<boolean> {
  try {
    const filePath = getJobPath(id);
    await fs.unlink(filePath);
    log.info('[CronJobStore] 删除任务:', id);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    log.error('[CronJobStore] 删除任务失败:', id, err);
    throw err;
  }
}

/**
 * 更新任务执行记录
 */
export async function updateJobRunRecord(
  id: string,
  result: { success: boolean; message?: string; threadId?: string }
): Promise<void> {
  const job = await getCronJob(id);
  if (!job) return;

  const now = new Date().toISOString();
  const updatedJob: CronJob = {
    ...job,
    lastRunAt: now,
    runCount: job.runCount + 1,
    lastRunResult: result,
    updatedAt: now
  };

  const filePath = getJobPath(id);
  await fs.writeFile(filePath, JSON.stringify(updatedJob, null, 2), 'utf-8');
}
