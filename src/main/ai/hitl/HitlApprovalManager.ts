/**
 * HITL 审批管理器
 *
 * 参考 OpenClaw ExecApprovalManager，采用纯内存 Promise 等待模式：
 *
 *   1. 执行循环检测到 HITL 中断后，调用 waitForDecisions() 获得一个 Promise
 *   2. Promise 阻塞执行循环（async/await 暂停）
 *   3. 前端通过 API 逐个提交决策，调用 submitDecision()
 *   4. 当所有工具都有决策后，Promise 自动 resolve，执行循环被唤醒
 *
 * 设计特征（与 OpenClaw 对齐）：
 *   - 纯内存，不持久化（进程重启丢失，有意设计）
 *   - 超时后 resolve(null)，由调用方处理
 *   - submitDecision() 幂等安全（重复提交同一 index 不会重复计数）
 */

import { log } from '@main/common/logger'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

// ==================== 类型定义 ====================

/** 等待中的审批条目 */
interface PendingApproval {
  /** 各工具的决策（null = 尚未决策） */
  decisions: (HitlApprovalDecision | null)[]
  /** 已提交决策的工具数量 */
  resolvedCount: number
  /** resolve 回调（唤醒等待的 Promise） */
  resolve: (decisions: HitlApprovalDecision[] | null) => void
  /** 超时计时器 */
  timer: ReturnType<typeof setTimeout>
  /** 创建时间（用于调试） */
  createdAt: number
}

// ==================== 常量 ====================

/** 默认审批超时（120 秒，与 OpenClaw 对齐） */
export const DEFAULT_HITL_TIMEOUT_MS = 120_000

// ==================== HitlApprovalManager ====================

export class HitlApprovalManager {
  /** 等待中的审批请求（key = sessionId） */
  private pending = new Map<string, PendingApproval>()

  /**
   * 等待所有工具的审批决策
   *
   * 返回一个 Promise，在以下情况之一 resolve：
   *   1. 所有工具都提交了决策 → resolve(decisions[])
   *   2. 超时 → resolve(null)
   *
   * @param sessionId  会话 ID
   * @param count      需要审批的工具数量
   * @param timeoutMs  超时时间（默认 120s）
   */
  waitForDecisions(
    sessionId: string,
    count: number,
    timeoutMs: number = DEFAULT_HITL_TIMEOUT_MS
  ): Promise<HitlApprovalDecision[] | null> {
    // 清理旧的 pending（如果有的话，防止泄漏）
    this.cleanup(sessionId)

    return new Promise<HitlApprovalDecision[] | null>((resolve) => {
      const decisions: (HitlApprovalDecision | null)[] = new Array(count).fill(null)

      const timer = setTimeout(() => {
        log.warn(`[HitlApprovalManager] Timeout: sessionId=${sessionId}, ${timeoutMs}ms elapsed`)
        this.pending.delete(sessionId)
        resolve(null)
      }, timeoutMs)

      this.pending.set(sessionId, {
        decisions,
        resolvedCount: 0,
        resolve,
        timer,
        createdAt: Date.now()
      })

      log.info(
        `[HitlApprovalManager] Waiting: sessionId=${sessionId}, tools=${count}, timeout=${timeoutMs}ms`
      )
    })
  }

  /**
   * 提交单个工具的审批决策
   *
   * 当所有工具都有决策后，自动 resolve 等待的 Promise。
   *
   * @returns true = 提交成功，false = 无对应的 pending 或 index 无效
   */
  submitDecision(sessionId: string, index: number, decision: HitlApprovalDecision): boolean {
    const entry = this.pending.get(sessionId)
    if (!entry) {
      log.warn(`[HitlApprovalManager] No pending approval: sessionId=${sessionId}`)
      return false
    }

    if (index < 0 || index >= entry.decisions.length) {
      log.warn(
        `[HitlApprovalManager] Invalid index: sessionId=${sessionId}, index=${index}, total=${entry.decisions.length}`
      )
      return false
    }

    // 幂等：已有决策不重复计数
    if (entry.decisions[index] !== null) {
      log.info(
        `[HitlApprovalManager] Already decided: sessionId=${sessionId}, index=${index}, replacing ${entry.decisions[index]} with ${decision}`
      )
      entry.decisions[index] = decision
      return true
    }

    entry.decisions[index] = decision
    entry.resolvedCount++

    log.info(
      `[HitlApprovalManager] Decision: sessionId=${sessionId}, index=${index}, decision=${decision}, progress=${entry.resolvedCount}/${entry.decisions.length}`
    )

    // 所有工具都有决策 → resolve Promise 唤醒执行循环
    if (entry.resolvedCount >= entry.decisions.length) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
      entry.resolve(entry.decisions as HitlApprovalDecision[])

      log.info(`[HitlApprovalManager] All decided: sessionId=${sessionId}, resolving`)
    }

    return true
  }

  /**
   * 查询某 session 是否有等待中的审批
   */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  /**
   * 获取等待中的审批信息（用于状态查询）
   */
  getPendingInfo(sessionId: string): {
    totalCount: number
    resolvedCount: number
    decisions: (HitlApprovalDecision | null)[]
  } | null {
    const entry = this.pending.get(sessionId)
    if (!entry) return null

    return {
      totalCount: entry.decisions.length,
      resolvedCount: entry.resolvedCount,
      decisions: [...entry.decisions]
    }
  }

  /**
   * 清理指定 session 的 pending（取消等待）
   */
  cleanup(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
      entry.resolve(null)
      log.info(`[HitlApprovalManager] Cleaned up: sessionId=${sessionId}`)
    }
  }

  /**
   * 清理所有 pending（关闭时调用）
   */
  cleanupAll(): void {
    for (const [sessionId, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve(null)
      log.info(`[HitlApprovalManager] Cleaned up (shutdown): sessionId=${sessionId}`)
    }
    this.pending.clear()
  }
}

// ==================== 单例导出 ====================

export const hitlApprovalManager = new HitlApprovalManager()
