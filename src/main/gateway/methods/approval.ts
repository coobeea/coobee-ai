/**
 * Gateway HITL Approval 方法组
 *
 * 方法：
 *   hitl.decide — 提交审批决策
 *
 * 审批模型（per-tool-call）：
 *   tool-approval Extension 为每个需要审批的工具调用生成唯一的 approvalId（格式：sessionId:index）。
 *   前端通过 hitl:required 事件获取 index，然后调用此方法提交决策。
 *   HitlApprovalManager 使用 approvalId 作为 key 进行 per-call 等待/唤醒。
 */

import { log } from '@main/common/logger'
import { hitlApprovalManager } from '@main/ai/hitl/HitlApprovalManager'
import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'
import type { HitlApprovalDecision } from '@shared/stream-protocol'

export const approvalMethods: MethodGroup = {
  namespace: 'hitl',
  methods: {
    decide: async (params) => {
      const { sessionId, index, decision } = params as {
        sessionId?: string
        index?: number
        decision?: HitlApprovalDecision
      }

      // 参数校验
      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required')
      }
      if (typeof index !== 'number' || index < 0) {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          'index must be a non-negative number'
        )
      }

      const validDecisions: HitlApprovalDecision[] = ['approve-once', 'approve-always', 'reject']
      if (!decision || !validDecisions.includes(decision)) {
        throw new GatewayMethodError(
          GatewayErrorCode.INVALID_PARAMS,
          `Invalid decision: ${decision}`
        )
      }

      // 构造 approvalId（与 tool-approval Extension 约定的格式一致）
      const approvalId = `${sessionId}:${index}`
      log.info(`[hitl.decide] approvalId=${approvalId}, decision=${decision}`)

      const success = hitlApprovalManager.submitSingleDecision(approvalId, decision)
      if (!success) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'No pending approval for this approvalId'
        )
      }

      return { ok: true }
    }
  }
}
