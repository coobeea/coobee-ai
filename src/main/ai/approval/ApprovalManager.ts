/**
 * ApprovalManager - 审批管理器
 *
 * 管理多阶段审批流程和人工介入
 */

import { createLogger } from '@main/common/logger';
import type { ApprovalRequest, ApprovalResponse, ApprovalConfig } from './types';

const log = createLogger('approval-manager');

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();
  private config: ApprovalConfig;

  constructor(config: ApprovalConfig) {
    this.config = config;
  }

  /**
   * 创建审批请求
   */
  createRequest(
    taskId: string,
    stageName: string,
    type: ApprovalRequest['type'],
    description: string,
    requestor: string,
    riskLevel?: ApprovalRequest['riskLevel']
  ): ApprovalRequest {
    if (!this.config.enabled) {
      throw new Error('Approval system is disabled');
    }

    const now = Date.now();
    const requestId = `approval-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const finalRiskLevel = riskLevel || this.inferRiskLevel(type);

    const approvers = this.config.approversByRisk[finalRiskLevel] || this.config.defaultApprovers;

    const request: ApprovalRequest = {
      id: requestId,
      taskId,
      stageName,
      type,
      description,
      riskLevel: finalRiskLevel,
      requestor,
      approvers,
      approved: [],
      rejected: [],
      comments: [],
      strategy: this.config.defaultStrategy,
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.config.requestTimeout
    };

    this.requests.set(requestId, request);

    log.info(
      `[ApprovalManager] Created approval request: ${requestId} (${finalRiskLevel} risk, ${approvers.length} approvers)`
    );

    return request;
  }

  /**
   * 提交审批响应
   */
  respond(requestId: string, response: Omit<ApprovalResponse, 'requestId' | 'timestamp'>): boolean {
    const request = this.requests.get(requestId);

    if (!request) {
      log.warn(`[ApprovalManager] Request ${requestId} not found`);
      return false;
    }

    if (request.status !== 'pending') {
      log.warn(`[ApprovalManager] Request ${requestId} is ${request.status}`);
      return false;
    }

    if (!request.approvers.includes(response.approver)) {
      log.warn(`[ApprovalManager] ${response.approver} is not an approver for ${requestId}`);
      return false;
    }

    request.comments.push({
      approver: response.approver,
      decision: response.decision,
      comment: response.comment || '',
      timestamp: Date.now()
    });

    if (response.decision === 'approve') {
      request.approved.push(response.approver);
    } else {
      request.rejected.push(response.approver);
    }

    this.evaluateRequest(request);

    log.info(`[ApprovalManager] ${response.approver} ${response.decision}d request ${requestId}`);

    return true;
  }

  /**
   * 评估审批结果
   */
  private evaluateRequest(request: ApprovalRequest): void {
    const totalApprovers = request.approvers.length;
    const approvedCount = request.approved.length;
    const rejectedCount = request.rejected.length;

    let shouldApprove = false;
    let shouldReject = false;

    switch (request.strategy) {
      case 'any':
        shouldApprove = approvedCount > 0;
        shouldReject = rejectedCount === totalApprovers;
        break;

      case 'all':
        shouldApprove = approvedCount === totalApprovers;
        shouldReject = rejectedCount > 0;
        break;

      case 'majority':
        shouldApprove = approvedCount > totalApprovers / 2;
        shouldReject = rejectedCount > totalApprovers / 2;
        break;
    }

    if (shouldApprove) {
      request.status = 'approved';
      log.info(`[ApprovalManager] Request ${request.id} APPROVED`);
    } else if (shouldReject) {
      request.status = 'rejected';
      log.info(`[ApprovalManager] Request ${request.id} REJECTED`);
    }
  }

  /**
   * 等待审批结果
   */
  async waitForApproval(requestId: string, pollInterval = 1000): Promise<'approved' | 'rejected' | 'expired'> {
    const request = this.requests.get(requestId);

    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    while (request.status === 'pending') {
      if (request.expiresAt && Date.now() > request.expiresAt) {
        request.status = 'expired';
        log.warn(`[ApprovalManager] Request ${requestId} expired`);
        return 'expired';
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return request.status === 'approved' ? 'approved' : 'rejected';
  }

  /**
   * 获取审批请求
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * 列出所有请求
   */
  listRequests(filters?: { status?: ApprovalRequest['status']; taskId?: string }): ApprovalRequest[] {
    let requests = Array.from(this.requests.values());

    if (filters?.status) {
      requests = requests.filter((r) => r.status === filters.status);
    }

    if (filters?.taskId) {
      requests = requests.filter((r) => r.taskId === filters.taskId);
    }

    return requests.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 推断风险等级
   */
  private inferRiskLevel(type: ApprovalRequest['type']): ApprovalRequest['riskLevel'] {
    switch (type) {
      case 'deployment':
        return 'high';
      case 'external-api':
        return 'medium';
      case 'data-access':
        return 'high';
      case 'code-change':
        return 'low';
      default:
        return 'medium';
    }
  }
}
