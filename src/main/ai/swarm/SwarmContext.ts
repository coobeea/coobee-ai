/**
 * SwarmContext - 共享上下文黑板
 *
 * 为 Swarm 中所有 Agent 提供共享状态：
 * - 键值对读写（任意状态数据）
 * - 中间产物存储（代码、文档等）
 * - 任务进度跟踪
 * - 所有 Agent 可通过工具函数访问
 */

import { createLogger } from '@main/common/logger';
import type { SwarmArtifact, SwarmContextData } from './types';

const log = createLogger('SwarmContext');

/**
 * 上下文变更事件
 */
export interface ContextChangeEvent {
  /** 变更类型 */
  type: 'state_set' | 'state_delete' | 'artifact_added' | 'progress_updated';
  /** 变更的键/名称 */
  key: string;
  /** 操作的角色 ID */
  roleId: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 上下文变更监听器
 */
export type ContextChangeListener = (event: ContextChangeEvent) => void;

/**
 * 共享上下文黑板
 */
export class SwarmContext {
  /** 上下文数据 */
  private data: SwarmContextData = {
    state: {},
    artifacts: [],
    progressNotes: []
  };

  /** 变更监听器 */
  private changeListeners: ContextChangeListener[] = [];

  /** 变更历史（用于审计） */
  private changeHistory: ContextChangeEvent[] = [];

  // ========== 状态读写 ==========

  /**
   * 设置状态值
   * @param key 键
   * @param value 值
   * @param roleId 操作者角色 ID
   */
  set(key: string, value: unknown, roleId: string = 'system'): void {
    this.data.state[key] = value;
    this.emitChange({
      type: 'state_set',
      key,
      roleId,
      timestamp: Date.now()
    });
  }

  /**
   * 获取状态值
   * @param key 键
   * @returns 值，不存在时返回 undefined
   */
  get<T = unknown>(key: string): T | undefined {
    return this.data.state[key] as T | undefined;
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    return key in this.data.state;
  }

  /**
   * 删除状态值
   */
  delete(key: string, roleId: string = 'system'): boolean {
    if (!(key in this.data.state)) {
      return false;
    }

    delete this.data.state[key];
    this.emitChange({
      type: 'state_delete',
      key,
      roleId,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * 获取所有状态键
   */
  keys(): string[] {
    return Object.keys(this.data.state);
  }

  /**
   * 获取完整状态快照
   */
  getState(): Record<string, unknown> {
    return { ...this.data.state };
  }

  // ========== 中间产物管理 ==========

  /**
   * 添加中间产物
   * @param name 产物名称
   * @param content 产物内容
   * @param createdBy 创建者角色 ID
   * @param type 产物类型（如 code, document, analysis）
   */
  addArtifact(name: string, content: string, createdBy: string, type?: string): void {
    const artifact: SwarmArtifact = {
      name,
      content,
      createdBy,
      createdAt: Date.now(),
      type
    };

    this.data.artifacts.push(artifact);
    this.emitChange({
      type: 'artifact_added',
      key: name,
      roleId: createdBy,
      timestamp: Date.now()
    });

    log.info(`Artifact added: "${name}" by ${createdBy}`);
  }

  /**
   * 获取指定名称的产物
   */
  getArtifact(name: string): SwarmArtifact | undefined {
    // 返回最新的同名产物
    for (let i = this.data.artifacts.length - 1; i >= 0; i--) {
      if (this.data.artifacts[i].name === name) {
        return this.data.artifacts[i];
      }
    }
    return undefined;
  }

  /**
   * 获取所有产物
   */
  getArtifacts(): SwarmArtifact[] {
    return [...this.data.artifacts];
  }

  /**
   * 获取指定角色创建的产物
   */
  getArtifactsByRole(roleId: string): SwarmArtifact[] {
    return this.data.artifacts.filter((a) => a.createdBy === roleId);
  }

  /**
   * 获取指定类型的产物
   */
  getArtifactsByType(type: string): SwarmArtifact[] {
    return this.data.artifacts.filter((a) => a.type === type);
  }

  // ========== 进度跟踪 ==========

  /**
   * 添加进度说明
   * @param note 进度说明
   * @param roleId 报告者角色 ID
   */
  addProgressNote(note: string, roleId: string = 'system'): void {
    const timestampedNote = `[${new Date().toISOString()}] [${roleId}] ${note}`;
    this.data.progressNotes.push(timestampedNote);

    this.emitChange({
      type: 'progress_updated',
      key: 'progress',
      roleId,
      timestamp: Date.now()
    });
  }

  /**
   * 获取所有进度说明
   */
  getProgressNotes(): string[] {
    return [...this.data.progressNotes];
  }

  /**
   * 获取最近 N 条进度说明
   */
  getRecentProgress(count: number = 5): string[] {
    return this.data.progressNotes.slice(-count);
  }

  // ========== 序列化（用于注入 Agent 提示词） ==========

  /**
   * 生成上下文摘要（可注入到 Agent 的提示词中）
   */
  toSummary(): string {
    const parts: string[] = [];

    // 状态摘要
    const stateKeys = Object.keys(this.data.state);
    if (stateKeys.length > 0) {
      parts.push('## 共享状态');
      for (const key of stateKeys) {
        const value = this.data.state[key];
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        parts.push(`- **${key}**: ${valueStr}`);
      }
    }

    // 产物摘要
    if (this.data.artifacts.length > 0) {
      parts.push('\n## 中间产物');
      for (const artifact of this.data.artifacts) {
        parts.push(`- **${artifact.name}** (${artifact.type || 'unknown'}, by ${artifact.createdBy})`);
      }
    }

    // 进度摘要
    const recentProgress = this.getRecentProgress(3);
    if (recentProgress.length > 0) {
      parts.push('\n## 最近进度');
      for (const note of recentProgress) {
        parts.push(`- ${note}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 导出完整上下文数据
   */
  export(): SwarmContextData {
    return {
      state: { ...this.data.state },
      artifacts: [...this.data.artifacts],
      progressNotes: [...this.data.progressNotes]
    };
  }

  /**
   * 从数据导入恢复上下文
   */
  import(data: SwarmContextData): void {
    this.data = {
      state: { ...data.state },
      artifacts: [...data.artifacts],
      progressNotes: [...data.progressNotes]
    };
  }

  // ========== 事件系统 ==========

  /**
   * 注册变更监听器
   */
  addChangeListener(listener: ContextChangeListener): void {
    this.changeListeners.push(listener);
  }

  /**
   * 移除变更监听器
   */
  removeChangeListener(listener: ContextChangeListener): void {
    const index = this.changeListeners.indexOf(listener);
    if (index !== -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  /**
   * 获取变更历史
   */
  getChangeHistory(): ContextChangeEvent[] {
    return [...this.changeHistory];
  }

  /**
   * 发送变更事件
   */
  private emitChange(event: ContextChangeEvent): void {
    this.changeHistory.push(event);

    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('Change listener error:', error);
      }
    }
  }

  // ========== 清理 ==========

  /**
   * 清空所有数据
   */
  clear(): void {
    this.data = {
      state: {},
      artifacts: [],
      progressNotes: []
    };
    this.changeHistory = [];
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.clear();
    this.changeListeners = [];
  }
}
