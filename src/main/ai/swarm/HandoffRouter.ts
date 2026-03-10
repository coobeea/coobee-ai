/**
 * HandoffRouter - Handoff 路由管理
 *
 * SDK 无关 — 纯路由逻辑，不构建 SDK handoff 对象。
 *
 * 职责：
 * - 记录完整交接历史
 * - 检测循环交接（防止无限递归）
 * - 深度限制
 * - 统计分析
 */

import type { HandoffRecord, SwarmConfig } from './types';

/** Handoff 历史最大条数，防止内存泄漏 */
const MAX_HANDOFF_HISTORY = 200;

/**
 * Handoff 回调函数类型
 */
export type OnHandoffCallback = (fromRoleId: string, toRoleId: string, data?: unknown) => void;

/**
 * Handoff 路由管理器
 */
export class HandoffRouter {
  private history: HandoffRecord[] = [];
  private recordCounter = 0;
  private currentChain: string[] = [];
  private onHandoffCallback: OnHandoffCallback | null = null;

  constructor(private readonly config: SwarmConfig) {}

  // ========== Handoff 记录 ==========

  /**
   * 记录一次 Handoff 并返回记录
   */
  recordHandoff(fromRoleId: string, toRoleId: string, inputData?: unknown): HandoffRecord {
    this.recordCounter++;
    this.currentChain.push(toRoleId);
    const depth = this.currentChain.length;

    const record: HandoffRecord = {
      id: `handoff-${this.recordCounter}`,
      fromRoleId,
      toRoleId,
      inputData,
      timestamp: Date.now(),
      depth
    };

    this.history.push(record);
    if (this.history.length > MAX_HANDOFF_HISTORY) {
      this.history.shift();
    }

    if (this.onHandoffCallback) {
      this.onHandoffCallback(fromRoleId, toRoleId, inputData);
    }

    return record;
  }

  // ========== 循环检测 ==========

  wouldCauseLoop(targetRoleId: string): boolean {
    return this.currentChain.includes(targetRoleId);
  }

  isMaxDepthReached(): boolean {
    return this.currentChain.length >= this.config.maxHandoffDepth;
  }

  getCurrentDepth(): number {
    return this.currentChain.length;
  }

  resetChain(): void {
    this.currentChain = [];
  }

  // ========== 历史查询 ==========

  getHistory(): HandoffRecord[] {
    return [...this.history];
  }

  getHistoryByRole(roleId: string, direction: 'from' | 'to'): HandoffRecord[] {
    return this.history.filter((record) =>
      direction === 'from' ? record.fromRoleId === roleId : record.toRoleId === roleId
    );
  }

  getCurrentChain(): string[] {
    return [...this.currentChain];
  }

  getStats(): {
    totalHandoffs: number;
    averageDepth: number;
    maxDepth: number;
    currentDepth: number;
    roleTransitions: Record<string, number>;
  } {
    const roleTransitions: Record<string, number> = {};
    let totalDepth = 0;
    let maxDepth = 0;

    for (const record of this.history) {
      const key = `${record.fromRoleId} -> ${record.toRoleId}`;
      roleTransitions[key] = (roleTransitions[key] || 0) + 1;
      totalDepth += record.depth;
      if (record.depth > maxDepth) maxDepth = record.depth;
    }

    return {
      totalHandoffs: this.history.length,
      averageDepth: this.history.length > 0 ? totalDepth / this.history.length : 0,
      maxDepth,
      currentDepth: this.currentChain.length,
      roleTransitions
    };
  }

  // ========== 事件回调 ==========

  setOnHandoff(callback: OnHandoffCallback): void {
    this.onHandoffCallback = callback;
  }

  // ========== 清理 ==========

  clearHistory(): void {
    this.history = [];
    this.recordCounter = 0;
    this.currentChain = [];
  }

  destroy(): void {
    this.clearHistory();
    this.onHandoffCallback = null;
  }
}
