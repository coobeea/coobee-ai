/**
 * HITL Approval API
 *
 * 极薄入口层 — 转发前端审批决策到 HitlApprovalManager。
 *
 * 路由: POST /api/chat/approval/decide
 *
 * 工作流程：
 *   1. 前端收到 WebSocket 的 hitl 消息（工具需要审批）
 *   2. 用户在 UI 上做出决策（approve-once / approve-always / reject）
 *   3. 前端调用此端点提交决策
 *   4. HitlApprovalManager 收到决策，当所有工具都有决策后自动唤醒执行循环
 *
 * 注意：无需 resume 端点。执行循环在 AgentExecutor 中 await Promise，
 * 决策提交完成后 Promise 自动 resolve，流自动恢复。
 */

import { log } from '@main/common/logger'
import { Post } from '@main/common/server'
import { hitlApprovalManager } from '@main/ai/hitl/HitlApprovalManager'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

// ==================== API 端点 ====================

export default class ApprovalApi {
  /**
   * 提交审批决策
   *
   * 前端为每个需要审批的工具逐个调用此端点。
   * 当所有工具都提交决策后，后台执行循环自动恢复。
   *
   * @param sessionId  会话 ID
   * @param index      工具审批索引（从 0 开始）
   * @param decision   决策: 'approve-once' | 'approve-always' | 'reject'
   */
  @Post()
  async decide(
    sessionId: string,
    index: number,
    decision: HitlApprovalDecision
  ): Promise<{ ok: boolean; error?: string }> {
    log.info(`[ApprovalApi] Decide: sessionId=${sessionId}, index=${index}, decision=${decision}`)

    // 参数校验
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' }
    }

    if (typeof index !== 'number' || index < 0) {
      return { ok: false, error: 'index must be a non-negative number' }
    }

    const validDecisions: HitlApprovalDecision[] = ['approve-once', 'approve-always', 'reject']
    if (!validDecisions.includes(decision)) {
      return { ok: false, error: `Invalid decision: ${decision}` }
    }

    const success = hitlApprovalManager.submitDecision(sessionId, index, decision)

    if (!success) {
      return {
        ok: false,
        error: 'No pending approval for this session or invalid index'
      }
    }

    return { ok: true }
  }
}
