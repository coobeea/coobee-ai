/**
 * Thread 检查点管理器
 *
 * 管理 Thread 执行状态的检查点（checkpoint.json）。
 * 每个 Thread 在 workspace 根目录下有且只有一个检查点文件，覆盖更新。
 *
 * 检查点用于：
 *   - 异步审批恢复：Agent run 结束后，通过检查点知道在等什么
 *   - 崩溃恢复：系统重启后，扫描检查点确定哪些 Thread 需要恢复
 *   - 状态同步：前端查询 Thread 运行时状态
 *
 * 存储位置：{workspacesDir}/{threadId}/checkpoint.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { ThreadCheckpoint, ThreadRunStatus } from './types';

const log = createLogger('checkpoint');

export class CheckpointManager {
  private static instance: CheckpointManager | null = null;
  private workspacesDir: string | null = null;

  static getInstance(): CheckpointManager {
    if (!CheckpointManager.instance) {
      CheckpointManager.instance = new CheckpointManager();
    }
    return CheckpointManager.instance;
  }

  static resetInstance(): void {
    CheckpointManager.instance = null;
  }

  private async getWorkspacesDir(): Promise<string> {
    if (!this.workspacesDir) {
      const { Env } = await import('@main/common/env');
      this.workspacesDir = Env.paths.workspacesDir;
    }
    return this.workspacesDir;
  }

  private async getCheckpointPath(threadId: string): Promise<string> {
    const dir = await this.getWorkspacesDir();
    return path.join(dir, threadId, '.runtime', 'checkpoint.json');
  }

  /**
   * 保存检查点（覆盖写入）
   */
  async save(checkpoint: ThreadCheckpoint): Promise<void> {
    try {
      const filePath = await this.getCheckpointPath(checkpoint.threadId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
      log.debug(`[Checkpoint] Saved: ${checkpoint.threadId} → ${checkpoint.runStatus}`);
    } catch (error) {
      log.error(`[Checkpoint] Failed to save for ${checkpoint.threadId}:`, error);
    }
  }

  /**
   * 读取检查点
   */
  async load(threadId: string): Promise<ThreadCheckpoint | null> {
    try {
      const filePath = await this.getCheckpointPath(threadId);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as ThreadCheckpoint;
    } catch (error) {
      log.warn(`[Checkpoint] Failed to load for ${threadId}:`, error);
      return null;
    }
  }

  /**
   * 清除检查点（任务完成时调用）
   */
  async clear(threadId: string): Promise<void> {
    try {
      const filePath = await this.getCheckpointPath(threadId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.debug(`[Checkpoint] Cleared: ${threadId}`);
      }
    } catch (error) {
      log.warn(`[Checkpoint] Failed to clear for ${threadId}:`, error);
    }
  }

  /**
   * 快捷方法：更新 runStatus 并保存
   */
  async updateStatus(threadId: string, runStatus: ThreadRunStatus): Promise<void> {
    const existing = await this.load(threadId);
    const checkpoint: ThreadCheckpoint = {
      ...(existing || { threadId }),
      threadId,
      runStatus,
      updatedAt: new Date().toISOString()
    };
    if (runStatus === 'idle' || runStatus === 'completed') {
      delete checkpoint.activeAgent;
      delete checkpoint.pendingOperation;
    }
    await this.save(checkpoint);
  }

  /**
   * 扫描所有未完成的检查点（系统重启恢复用）
   */
  async findPending(): Promise<ThreadCheckpoint[]> {
    const pending: ThreadCheckpoint[] = [];
    try {
      const dir = await this.getWorkspacesDir();
      if (!fs.existsSync(dir)) return pending;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const cpPath = path.join(dir, entry.name, '.runtime', 'checkpoint.json');
        if (!fs.existsSync(cpPath)) continue;

        try {
          const raw = fs.readFileSync(cpPath, 'utf-8');
          const cp = JSON.parse(raw) as ThreadCheckpoint;
          if (cp.runStatus !== 'idle' && cp.runStatus !== 'completed') {
            pending.push(cp);
          }
        } catch {
          // skip malformed checkpoints
        }
      }
    } catch (error) {
      log.error('[Checkpoint] Failed to scan pending:', error);
    }
    return pending;
  }
}
