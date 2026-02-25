/**
 * Gateway HITL Approval 方法组
 *
 * 方法：
 *   hitl.decide — 提交审批决策
 *
 * 审批模型：
 *   支持两种模式（由 tool-approval Extension 的 asyncMode 配置决定）：
 *
 *   同步模式：Extension 阻塞等待 → submitSingleDecision 唤醒 Promise
 *   异步模式：Extension 返回 suspend → Agent run 结束 → 用户审批 →
 *             此处触发 thread:wake 事件 → ThreadWaker 执行工具并恢复 Agent run
 */

import { log } from '@main/common/logger';
import { hitlApprovalManager } from '@main/ai/hitl/HitlApprovalManager';
import { eventBus } from '@main/common/eventbus';
import { CheckpointManager } from '@main/ai/threads/CheckpointManager';
import { AgentEventWriter } from '@main/ai/AgentEventWriter';
import type { ThreadWakeEvent } from '@main/ai/threads/ThreadWaker';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

export const approvalMethods: MethodGroup = {
  namespace: 'hitl',
  methods: {
    decide: async (params) => {
      const { sessionId, index, decision, toolName, toolParams } = params as {
        sessionId?: string;
        index?: number;
        decision?: HitlApprovalDecision;
        toolName?: string;
        toolParams?: Record<string, unknown>;
      };

      // 参数校验
      if (!sessionId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required');
      }
      if (typeof index !== 'number' || index < 0) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'index must be a non-negative number');
      }

      const validDecisions: HitlApprovalDecision[] = ['approve-once', 'approve-always', 'reject'];
      if (!decision || !validDecisions.includes(decision)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Invalid decision: ${decision}`);
      }

      const approvalId = `${sessionId}:${index}`;
      log.info(`[hitl.decide] approvalId=${approvalId}, decision=${decision}`);

      // 尝试同步模式：如果有 pending promise，直接 resolve 它
      const syncSuccess = hitlApprovalManager.submitSingleDecision(approvalId, decision);
      if (syncSuccess) {
        return { ok: true };
      }

      // 同步模式没有 pending → 尝试异步模式：检查 checkpoint 是否处于 approval-pending
      const checkpoint = await CheckpointManager.getInstance().load(sessionId);
      if (checkpoint?.runStatus === 'approval-pending') {
        log.info(`[hitl.decide] Async mode: emitting thread:wake for ${sessionId}`);

        const resolvedToolName = toolName || checkpoint.pendingOperation?.toolName || 'unknown';
        const action = decision === 'reject' ? 'rejected' : 'approved';
        AgentEventWriter.dispatchForSession(sessionId, {
          type: action === 'approved' ? 'hitl:approved' : 'hitl:rejected',
          content: `${action}: ${resolvedToolName}`,
          data: { index, toolName: resolvedToolName, action }
        });

        eventBus.emit('thread:wake', {
          threadId: sessionId,
          reason: 'tool-done',
          approvalDecision: decision,
          toolName: resolvedToolName,
          toolParams
        } satisfies ThreadWakeEvent);

        return { ok: true };
      }

      throw new GatewayMethodError(
        GatewayErrorCode.INTERNAL_ERROR,
        'No pending approval for this approvalId (neither sync nor async)'
      );
    }
  }
};
