/**
 * HITL 审批管理器
 *
 * 采用纯内存 Promise 等待模式（per-call）：
 *
 *   1. 执行循环检测到 HITL 中断后，调用 waitForSingleDecision(approvalId) 获得 Promise
 *   2. Promise 阻塞执行循环（async/await 暂停）
 *   3. 前端通过 hitl.decide API 提交决策，内部调用 submitSingleDecision(approvalId, decision)
 *   4. 决策提交后 Promise resolve，执行循环被唤醒
 *
 * 设计特征：
 *   - 纯内存，不持久化（进程重启丢失，有意设计）
 *   - 超时后 resolve(null)，由调用方处理
 */

import { log } from '@main/common/logger';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

// ==================== 常量 ====================

/** 默认审批超时（120 秒，与 OpenClaw 对齐） */
export const DEFAULT_HITL_TIMEOUT_MS = 120_000;

// ==================== HitlApprovalManager ====================

export class HitlApprovalManager {
  /**
   * 清理所有 pending（关闭时调用）
   */
  cleanupAll(): void {
    const singleEntries = Array.from(this.singlePending.entries());
    for (const [approvalId, entry] of singleEntries) {
      clearTimeout(entry.timer);
      entry.resolve(null);
      log.info(`[HitlApprovalManager] Cleaned up single (shutdown): approvalId=${approvalId}`);
    }
    this.singlePending.clear();
  }

  // ==================== 单工具调用审批（per-call 模式） ====================

  /** 等待中的单工具审批请求 */
  private singlePending = new Map<
    string,
    {
      resolve: (decision: HitlApprovalDecision | null) => void;
      timer: ReturnType<typeof setTimeout>;
      createdAt: number;
    }
  >();

  /**
   * 等待单个工具调用的审批决策
   *
   * 用于 before_tool_call Hook 中的 HITL 等待。
   * 每个工具调用独立等待，不再批量绑定。
   *
   * @param approvalId 唯一审批 ID（格式：sessionId:index）
   * @param timeoutMs  超时时间
   */
  waitForSingleDecision(
    approvalId: string,
    timeoutMs: number = DEFAULT_HITL_TIMEOUT_MS
  ): Promise<HitlApprovalDecision | null> {
    // 清理旧的（如果有）
    const old = this.singlePending.get(approvalId);
    if (old) {
      clearTimeout(old.timer);
      this.singlePending.delete(approvalId);
      old.resolve(null);
    }

    return new Promise<HitlApprovalDecision | null>((resolve) => {
      const timer = setTimeout(() => {
        log.warn(`[HitlApprovalManager] Single timeout: approvalId=${approvalId}, ${timeoutMs}ms`);
        this.singlePending.delete(approvalId);
        resolve(null);
      }, timeoutMs);

      this.singlePending.set(approvalId, {
        resolve,
        timer,
        createdAt: Date.now()
      });

      log.info(`[HitlApprovalManager] Single waiting: approvalId=${approvalId}, timeout=${timeoutMs}ms`);
    });
  }

  /**
   * 提交单个工具调用的审批决策
   *
   * @param approvalId 审批 ID
   * @param decision   决策
   * @returns true = 提交成功
   */
  submitSingleDecision(approvalId: string, decision: HitlApprovalDecision): boolean {
    const entry = this.singlePending.get(approvalId);
    if (!entry) {
      log.warn(`[HitlApprovalManager] No single pending: approvalId=${approvalId}`);
      return false;
    }

    clearTimeout(entry.timer);
    this.singlePending.delete(approvalId);
    entry.resolve(decision);

    log.info(`[HitlApprovalManager] Single decided: approvalId=${approvalId}, decision=${decision}`);
    return true;
  }

  /**
   * 清理指定 session 的所有单工具审批（前缀匹配）
   */
  cleanupSession(sessionId: string): void {
    // 清理 single 模式（前缀匹配 sessionId:*）
    // 先收集要删除的 key，避免遍历时变异 Map
    const prefix = `${sessionId}:`;
    const toDelete: string[] = [];
    for (const [approvalId, entry] of this.singlePending) {
      if (approvalId.startsWith(prefix)) {
        clearTimeout(entry.timer);
        entry.resolve(null);
        toDelete.push(approvalId);
      }
    }

    // 批量删除
    for (const approvalId of toDelete) {
      this.singlePending.delete(approvalId);
      log.info(`[HitlApprovalManager] Cleaned up single: approvalId=${approvalId}`);
    }
  }

  /**
   * 查询某 approvalId 是否有等待中的单工具审批
   */
  hasSinglePending(approvalId: string): boolean {
    return this.singlePending.has(approvalId);
  }
}

// ==================== 单例导出 ====================

export const hitlApprovalManager = new HitlApprovalManager();
