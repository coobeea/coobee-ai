/**
 * TransferManager - 知识迁移管理器
 */

import { createLogger } from '@main/common/logger';
import { KnowledgeExtractor } from './KnowledgeExtractor';
import { KnowledgeAdapter } from './KnowledgeAdapter';
import type { KnowledgePackage, TransferTask, AdaptationConfig } from './types';

const log = createLogger('transfer-manager');

export class TransferManager {
  private extractor: KnowledgeExtractor;
  private adapter: KnowledgeAdapter;
  private packages = new Map<string, KnowledgePackage>();
  private tasks = new Map<string, TransferTask>();

  constructor() {
    this.extractor = new KnowledgeExtractor();
    this.adapter = new KnowledgeAdapter();
  }

  /**
   * 创建知识包
   */
  async createPackage(sourceProject: string, packageName: string): Promise<KnowledgePackage> {
    log.info(`[TransferManager] Creating knowledge package from ${sourceProject}`);

    const pkg = await this.extractor.extractFromProject(sourceProject, packageName);

    this.packages.set(pkg.id, pkg);

    log.info(`[TransferManager] Package created: ${pkg.id} with ${pkg.items.length} items`);

    return pkg;
  }

  /**
   * 迁移知识包
   */
  async transferPackage(packageId: string, targetProject: string, config: AdaptationConfig): Promise<TransferTask> {
    const pkg = this.packages.get(packageId);

    if (!pkg) {
      throw new Error(`Package ${packageId} not found`);
    }

    const taskId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const task: TransferTask = {
      id: taskId,
      sourceProject: pkg.sourceProject,
      targetProject,
      packageId,
      status: 'pending',
      progress: 0,
      createdAt: Date.now()
    };

    this.tasks.set(taskId, task);

    log.info(`[TransferManager] Starting transfer task: ${taskId}`);

    task.status = 'analyzing';
    task.progress = 0.2;

    await new Promise((resolve) => setTimeout(resolve, 100));

    task.status = 'adapting';
    task.progress = 0.5;

    const result = await this.adapter.adaptToProject(pkg, targetProject, config);

    task.status = 'completed';
    task.progress = 1.0;
    task.completedAt = Date.now();
    task.adaptationResult = {
      applicableItems: result.applicable.length,
      modifiedItems: result.modified.length,
      skippedItems: result.skipped.length
    };

    log.info(`[TransferManager] Transfer completed: ${taskId}`, task.adaptationResult);

    return task;
  }

  /**
   * 获取知识包
   */
  getPackage(packageId: string): KnowledgePackage | undefined {
    return this.packages.get(packageId);
  }

  /**
   * 列出所有知识包
   */
  listPackages(): KnowledgePackage[] {
    return Array.from(this.packages.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取迁移任务
   */
  getTask(taskId: string): TransferTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 列出迁移任务
   */
  listTasks(): TransferTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}
