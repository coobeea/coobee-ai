/**
 * OpportunityScanner - 机会扫描器
 *
 * 扫描项目并发现改进机会
 */

import { createLogger } from '@main/common/logger';
import type { Opportunity, ScanRule, ScanContext } from './types';

const log = createLogger('opportunity-scanner');

export class OpportunityScanner {
  private rules: ScanRule[] = [];
  private opportunities = new Map<string, Opportunity>();

  /**
   * 注册扫描规则
   */
  registerRule(rule: ScanRule): void {
    this.rules.push(rule);
    log.info(`[OpportunityScanner] Registered rule: ${rule.name}`);
  }

  /**
   * 执行扫描
   */
  async scan(context: ScanContext): Promise<Opportunity[]> {
    log.info('[OpportunityScanner] Starting scan...');

    const enabledRules = this.rules.filter((r) => r.enabled);
    const allOpportunities: Opportunity[] = [];

    for (const rule of enabledRules) {
      try {
        const opportunities = await rule.check(context);
        allOpportunities.push(...opportunities);
        log.debug(`[OpportunityScanner] Rule "${rule.name}" found ${opportunities.length} opportunities`);
      } catch (err) {
        log.error(`[OpportunityScanner] Rule "${rule.name}" failed:`, err);
      }
    }

    for (const opp of allOpportunities) {
      this.opportunities.set(opp.id, opp);
    }

    log.info(`[OpportunityScanner] Scan complete. Found ${allOpportunities.length} opportunities`);

    return allOpportunities;
  }

  /**
   * 获取所有机会
   */
  getOpportunities(filters?: { type?: Opportunity['type']; minPriority?: number }): Opportunity[] {
    let opportunities = Array.from(this.opportunities.values()).filter((o) => o.status !== 'dismissed');

    if (filters?.type) {
      opportunities = opportunities.filter((o) => o.type === filters.type);
    }

    if (filters?.minPriority !== undefined) {
      opportunities = opportunities.filter((o) => o.priority >= filters.minPriority!);
    }

    return opportunities.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 更新机会状态
   */
  updateStatus(opportunityId: string, status: Opportunity['status']): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) {
      opp.status = status;
      log.info(`[OpportunityScanner] Opportunity ${opportunityId} status: ${status}`);
    }
  }

  /**
   * 清除已处理的机会
   */
  clearProcessed(): void {
    const before = this.opportunities.size;

    for (const [id, opp] of this.opportunities.entries()) {
      if (opp.status === 'planned' || opp.status === 'dismissed') {
        this.opportunities.delete(id);
      }
    }

    const removed = before - this.opportunities.size;
    log.info(`[OpportunityScanner] Cleared ${removed} processed opportunities`);
  }
}
