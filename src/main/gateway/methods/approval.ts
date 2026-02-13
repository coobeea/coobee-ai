/**
 * Gateway HITL Approval 方法组
 *
 * 对应旧 api/chat/approval.ts。
 *
 * 方法：
 *   hitl.decide — 提交审批决策
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

      log.info(`[hitl.decide] sessionId=${sessionId}, index=${index}, decision=${decision}`)

      const success = hitlApprovalManager.submitDecision(sessionId, index, decision)
      if (!success) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'No pending approval for this session or invalid index'
        )
      }

      return { ok: true }
    }
  }
}
