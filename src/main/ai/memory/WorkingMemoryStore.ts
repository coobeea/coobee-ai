/**
 * 工作记忆存储
 * 管理会话级别的临时状态和变量
 */

import type { SessionFileManager } from '../storage/SessionFileManager';
import type { SessionState, Checkpoint } from './types';

/**
 * 工作记忆存储
 */
export class WorkingMemoryStore {
  private state: SessionState;

  constructor(
    private sessionManager: SessionFileManager,
    private sessionId: string
  ) {
    this.state = {
      sessionId,
      completedSubtasks: [],
      pendingSubtasks: [],
      failedSubtasks: [],
      checkpoints: [],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /**
   * 初始化（从文件加载状态）
   */
  async initialize(): Promise<void> {
    const savedState = await this.sessionManager.readSharedContext();

    if (savedState && typeof savedState === 'object' && 'sessionId' in savedState) {
      this.state = savedState as SessionState;
    }

    console.log(`[WorkingMemoryStore] Initialized for session: ${this.sessionId}`);
  }

  // ========== 变量管理 ==========

  /**
   * 设置变量
   */
  async setVariable(key: string, value: unknown): Promise<void> {
    this.state.variables[key] = value;
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 批量设置变量
   */
  async setVariables(variables: Record<string, unknown>): Promise<void> {
    Object.assign(this.state.variables, variables);
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 获取变量
   */
  getVariable<T = unknown>(key: string): T | undefined {
    return this.state.variables[key] as T | undefined;
  }

  /**
   * 删除变量
   */
  async deleteVariable(key: string): Promise<void> {
    delete this.state.variables[key];
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 获取所有变量
   */
  getAllVariables(): Record<string, unknown> {
    return { ...this.state.variables };
  }

  // ========== 计划状态 ==========

  /**
   * 设置当前计划
   */
  async setCurrentPlan(plan: { planVersion: number; totalSubTasks: number; completedSubTasks: number }): Promise<void> {
    this.state.currentPlan = plan;
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 更新计划进度
   */
  async updatePlanProgress(completedSubTasks: number): Promise<void> {
    if (this.state.currentPlan) {
      this.state.currentPlan.completedSubTasks = completedSubTasks;
      this.state.updatedAt = Date.now();
      await this.persist();
    }
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan(): SessionState['currentPlan'] {
    return this.state.currentPlan;
  }

  /**
   * 清除当前计划
   */
  async clearCurrentPlan(): Promise<void> {
    this.state.currentPlan = undefined;
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  // ========== 子任务状态 ==========

  /**
   * 添加待执行子任务
   */
  async addPendingSubtasks(subtaskIds: string[]): Promise<void> {
    for (const id of subtaskIds) {
      if (!this.state.pendingSubtasks.includes(id)) {
        this.state.pendingSubtasks.push(id);
      }
    }

    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 标记子任务完成
   */
  async markSubtaskCompleted(subtaskId: string): Promise<void> {
    // 从 pending 移除
    this.state.pendingSubtasks = this.state.pendingSubtasks.filter((id) => id !== subtaskId);

    // 添加到 completed
    if (!this.state.completedSubtasks.includes(subtaskId)) {
      this.state.completedSubtasks.push(subtaskId);
    }

    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 标记子任务失败
   */
  async markSubtaskFailed(subtaskId: string): Promise<void> {
    // 从 pending 移除
    this.state.pendingSubtasks = this.state.pendingSubtasks.filter((id) => id !== subtaskId);

    // 添加到 failed
    if (!this.state.failedSubtasks.includes(subtaskId)) {
      this.state.failedSubtasks.push(subtaskId);
    }

    this.state.updatedAt = Date.now();
    await this.persist();
  }

  /**
   * 获取子任务状态
   */
  getSubtaskStatus(): { completed: string[]; pending: string[]; failed: string[]; total: number } {
    return {
      completed: [...this.state.completedSubtasks],
      pending: [...this.state.pendingSubtasks],
      failed: [...this.state.failedSubtasks],
      total: this.state.completedSubtasks.length + this.state.pendingSubtasks.length + this.state.failedSubtasks.length
    };
  }

  /**
   * 清空子任务状态
   */
  async clearSubtaskStatus(): Promise<void> {
    this.state.completedSubtasks = [];
    this.state.pendingSubtasks = [];
    this.state.failedSubtasks = [];
    this.state.updatedAt = Date.now();
    await this.persist();
  }

  // ========== 检查点管理 ==========

  /**
   * 创建检查点（断点续传）
   */
  async createCheckpoint(customState?: Record<string, unknown>): Promise<string> {
    const checkpoint: Checkpoint = {
      id: `checkpoint-${Date.now()}`,
      timestamp: Date.now(),
      state: {
        ...this.state,
        ...customState
      }
    };

    this.state.checkpoints.push(checkpoint);
    await this.persist();

    console.log(`[WorkingMemoryStore] Created checkpoint: ${checkpoint.id}`);
    return checkpoint.id;
  }

  /**
   * 恢复到检查点
   */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.state.checkpoints.find((cp) => cp.id === checkpointId);

    if (!checkpoint) {
      return false;
    }

    // 确保 checkpoint.state 包含所有必需的字段
    if (typeof checkpoint.state === 'object' && checkpoint.state !== null && 'sessionId' in checkpoint.state) {
      this.state = checkpoint.state as unknown as SessionState;
      await this.persist();

      console.log(`[WorkingMemoryStore] Restored checkpoint: ${checkpointId}`);
      return true;
    }

    console.warn(`[WorkingMemoryStore] Invalid checkpoint state: ${checkpointId}`);
    return false;
  }

  /**
   * 列出所有检查点
   */
  listCheckpoints(): Array<{ id: string; timestamp: number }> {
    return this.state.checkpoints.map((cp) => ({
      id: cp.id,
      timestamp: cp.timestamp
    }));
  }

  /**
   * 删除检查点
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    const index = this.state.checkpoints.findIndex((cp) => cp.id === checkpointId);

    if (index === -1) {
      return false;
    }

    this.state.checkpoints.splice(index, 1);
    await this.persist();

    console.log(`[WorkingMemoryStore] Deleted checkpoint: ${checkpointId}`);
    return true;
  }

  // ========== 持久化 ==========

  /**
   * 持久化状态到文件
   */
  private async persist(): Promise<void> {
    await this.sessionManager.writeSharedContext(this.state);
  }

  /**
   * 获取完整状态（只读）
   */
  getState(): Readonly<SessionState> {
    return { ...this.state };
  }

  /**
   * 清空状态
   */
  async clearState(): Promise<void> {
    this.state = {
      sessionId: this.sessionId,
      completedSubtasks: [],
      pendingSubtasks: [],
      failedSubtasks: [],
      checkpoints: [],
      variables: {},
      createdAt: this.state.createdAt,
      updatedAt: Date.now()
    };

    await this.persist();
    console.log(`[WorkingMemoryStore] State cleared`);
  }
}
