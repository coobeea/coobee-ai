/**
 * 计划版本管理器
 * 负责管理所有计划版本的创建、查询和分析
 */

import type { SessionFileManager } from '../storage/SessionFileManager';
import type { ExecutionPlan, PlanIndex, PlanVersionMetadata, PlanChangeLog, PlanVersionReason } from './types';

/**
 * 计划版本管理器
 */
export class PlanVersionManager {
  private index: PlanIndex | null = null;

  constructor(
    private readonly sessionManager: SessionFileManager,
    private readonly sessionId: string
  ) {}

  /**
   * 初始化计划版本管理
   */
  async initialize(): Promise<void> {
    // 尝试加载现有索引
    const indexData = await this.sessionManager.readPlanIndex();
    this.index = indexData as PlanIndex | null;

    if (!this.index) {
      // 创建新索引
      this.index = {
        sessionId: this.sessionId,
        versions: [],
        currentVersion: 0,
        totalVersions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await this.saveIndex();
    }

    console.log(`[PlanVersionManager] Initialized with ${this.index.totalVersions} versions`);
  }

  /**
   * 创建新的计划版本
   */
  async createPlanVersion(
    plan: ExecutionPlan,
    reason: PlanVersionReason,
    reasonDetails?: string,
    parentVersion?: number
  ): Promise<number> {
    if (!this.index) {
      throw new Error('PlanVersionManager not initialized');
    }

    const newVersion = this.index.totalVersions + 1;
    const fileName = `plan-v${newVersion}.json`;

    // 创建版本元数据
    const metadata: PlanVersionMetadata = {
      version: newVersion,
      file: fileName,
      createdAt: Date.now(),
      createdBy: 'planner-agent',
      reason,
      reasonDetails,
      parentVersion: parentVersion || null,
      status: 'active',
      stats: {
        totalSubTasks: plan.subTasks.length,
        totalStages: plan.stages.length,
        estimatedDuration: plan.estimatedDuration || 0
      }
    };

    // 1. 保存计划文件
    await this.sessionManager.writePlanFile(fileName, plan);

    // 2. 如果有当前版本，标记为 replaced
    if (this.index.currentVersion > 0) {
      const currentMeta = this.index.versions.find((v) => v.version === this.index!.currentVersion);
      if (currentMeta) {
        currentMeta.status = 'replaced';
      }
    }

    // 3. 添加到索引
    this.index.versions.push(metadata);
    this.index.currentVersion = newVersion;
    this.index.totalVersions = newVersion;
    this.index.updatedAt = Date.now();
    await this.saveIndex();

    // 4. 记录变更日志
    await this.logPlanChange({
      timestamp: Date.now(),
      fromVersion: parentVersion || null,
      toVersion: newVersion,
      type: newVersion === 1 ? 'create' : 'replan',
      reason,
      reasonDetails,
      triggeredBy: 'orchestrator',
      changes: parentVersion ? await this.calculateChanges(parentVersion, newVersion) : undefined
    });

    console.log(`[PlanVersionManager] Created plan version ${newVersion} (reason: ${reason})`);

    return newVersion;
  }

  /**
   * 获取当前计划
   */
  async getCurrentPlan(): Promise<ExecutionPlan | null> {
    if (!this.index || this.index.currentVersion === 0) {
      return null;
    }

    return await this.getPlanByVersion(this.index.currentVersion);
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion(): number {
    return this.index?.currentVersion || 0;
  }

  /**
   * 获取指定版本的计划
   */
  async getPlanByVersion(version: number): Promise<ExecutionPlan | null> {
    const meta = this.index?.versions.find((v) => v.version === version);
    if (!meta) {
      return null;
    }

    const planData = await this.sessionManager.readPlanFile(meta.file);
    return planData as ExecutionPlan | null;
  }

  /**
   * 更新计划执行结果
   */
  async updatePlanExecution(
    version: number,
    execution: {
      startTime: number;
      endTime: number;
      completedSubTasks: number;
      failedSubTasks: number;
    }
  ): Promise<void> {
    if (!this.index) return;

    const meta = this.index.versions.find((v) => v.version === version);
    if (!meta) return;

    const totalSubTasks = meta.stats.totalSubTasks;
    meta.execution = {
      ...execution,
      duration: execution.endTime - execution.startTime,
      completionRate: execution.completedSubTasks / totalSubTasks,
      successRate: execution.completedSubTasks / (execution.completedSubTasks + execution.failedSubTasks)
    };

    await this.saveIndex();
  }

  /**
   * 获取计划历史
   */
  getPlanHistory(): PlanVersionMetadata[] {
    return this.index?.versions || [];
  }

  /**
   * 获取计划统计
   */
  async getPlanAnalytics(): Promise<{
    totalVersions: number;
    totalReplans: number;
    replanReasons: Record<string, number>;
    averageSubTasksPerPlan: number;
    planEffectiveness: Record<string, { completionRate: number; successRate: number }>;
  }> {
    if (!this.index) {
      return {
        totalVersions: 0,
        totalReplans: 0,
        replanReasons: {},
        averageSubTasksPerPlan: 0,
        planEffectiveness: {}
      };
    }

    const replanReasons: Record<string, number> = {};
    let totalSubTasks = 0;
    const planEffectiveness: Record<string, { completionRate: number; successRate: number }> = {};

    for (const version of this.index.versions) {
      // 统计重新规划原因
      if (version.version > 1) {
        replanReasons[version.reason] = (replanReasons[version.reason] || 0) + 1;
      }

      // 统计子任务数量
      totalSubTasks += version.stats.totalSubTasks;

      // 统计计划有效性
      if (version.execution) {
        planEffectiveness[`v${version.version}`] = {
          completionRate: version.execution.completionRate,
          successRate: version.execution.successRate
        };
      }
    }

    return {
      totalVersions: this.index.totalVersions,
      totalReplans: this.index.totalVersions - 1,
      replanReasons,
      averageSubTasksPerPlan: totalSubTasks / this.index.totalVersions,
      planEffectiveness
    };
  }

  /**
   * 归档旧计划（可选）
   */
  async archiveOldPlans(keepRecentCount: number = 10): Promise<void> {
    if (!this.index || this.index.totalVersions <= keepRecentCount) {
      return;
    }

    const toArchive = this.index.versions.filter((v) => v.status === 'replaced').slice(0, -keepRecentCount);

    for (const meta of toArchive) {
      // 标记为已归档
      meta.status = 'archived';
    }

    await this.saveIndex();
    console.log(`[PlanVersionManager] Archived ${toArchive.length} old plans`);
  }

  // ========== 私有方法 ==========

  private async saveIndex(): Promise<void> {
    if (!this.index) return;
    await this.sessionManager.writePlanIndex(this.index);
  }

  private async logPlanChange(log: PlanChangeLog): Promise<void> {
    await this.sessionManager.appendPlanChange(log);
  }

  private async calculateChanges(
    fromVersion: number,
    toVersion: number
  ): Promise<{ addedSubTasks: number; removedSubTasks: number; modifiedSubTasks: number }> {
    const oldPlan = await this.getPlanByVersion(fromVersion);
    const newPlan = await this.getPlanByVersion(toVersion);

    if (!oldPlan || !newPlan) {
      return { addedSubTasks: 0, removedSubTasks: 0, modifiedSubTasks: 0 };
    }

    // 简单比较（可以更精细）
    const oldIds = new Set(oldPlan.subTasks.map((st) => st.id));
    const newIds = new Set(newPlan.subTasks.map((st) => st.id));

    const added = newPlan.subTasks.filter((st) => !oldIds.has(st.id)).length;
    const removed = oldPlan.subTasks.filter((st) => !newIds.has(st.id)).length;

    // 计算修改的子任务数量（既在旧计划也在新计划中，但内容不同的）
    let modified = 0;
    for (const newSubTask of newPlan.subTasks) {
      const oldSubTask = oldPlan.subTasks.find((st) => st.id === newSubTask.id);
      if (oldSubTask) {
        // 比较子任务内容（使用 JSON 序列化进行深度比较）
        if (JSON.stringify(oldSubTask) !== JSON.stringify(newSubTask)) {
          modified++;
        }
      }
    }

    return {
      addedSubTasks: added,
      removedSubTasks: removed,
      modifiedSubTasks: modified
    };
  }
}
