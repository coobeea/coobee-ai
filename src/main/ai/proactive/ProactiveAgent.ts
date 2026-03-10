/**
 * ProactiveAgent - 主动式智能体
 *
 * 定期扫描项目并主动提出改进建议
 */

import { createLogger } from '@main/common/logger';
import { OpportunityScanner } from './OpportunityScanner';
import { defaultRules } from './rules';
import type { Opportunity, ProactiveConfig, ScanContext } from './types';

const log = createLogger('proactive-agent');

export class ProactiveAgent {
  private scanner: OpportunityScanner;
  private config: ProactiveConfig;
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(config: ProactiveConfig) {
    this.config = config;
    this.scanner = new OpportunityScanner();

    for (const rule of defaultRules) {
      this.scanner.registerRule(rule);
    }
  }

  /**
   * 启动主动扫描
   */
  start(context: ScanContext): void {
    if (!this.config.enabled) {
      log.info('[ProactiveAgent] Disabled, not starting');
      return;
    }

    if (this.scanTimer) {
      log.warn('[ProactiveAgent] Already running');
      return;
    }

    log.info(`[ProactiveAgent] Starting with scan interval: ${this.config.scanInterval}ms`);

    this.performScan(context).catch((err) => log.error('[ProactiveAgent] Initial scan failed:', err));

    this.scanTimer = setInterval(() => {
      this.performScan(context).catch((err) => log.error('[ProactiveAgent] Scan failed:', err));
    }, this.config.scanInterval);
  }

  /**
   * 停止扫描
   */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      log.info('[ProactiveAgent] Stopped');
    }
  }

  /**
   * 执行扫描
   */
  private async performScan(context: ScanContext): Promise<void> {
    log.info('[ProactiveAgent] Performing scan...');

    const opportunities = await this.scanner.scan(context);

    const filtered = opportunities.filter((o) => o.priority >= this.config.minPriority);

    if (filtered.length > 0) {
      this.notify(filtered);
    }

    log.info(`[ProactiveAgent] Scan complete. Found ${filtered.length} actionable opportunities`);
  }

  /**
   * 通知发现的机会
   */
  private notify(opportunities: Opportunity[]): void {
    if (this.config.notificationMethod === 'console' || this.config.notificationMethod === 'both') {
      log.info(`[ProactiveAgent] 🔍 发现 ${opportunities.length} 个改进机会：`);
      for (const opp of opportunities) {
        log.info(`  - [${opp.type}] ${opp.title} (优先级: ${opp.priority})`);
      }
    }

    if (this.config.notificationMethod === 'ui' || this.config.notificationMethod === 'both') {
      log.debug('[ProactiveAgent] UI notification not yet implemented');
    }
  }

  /**
   * 获取所有机会
   */
  getOpportunities(filters?: { type?: Opportunity['type']; minPriority?: number }): Opportunity[] {
    return this.scanner.getOpportunities(filters);
  }

  /**
   * 确认机会
   */
  acknowledgeOpportunity(opportunityId: string): void {
    this.scanner.updateStatus(opportunityId, 'acknowledged');
  }

  /**
   * 计划机会
   */
  planOpportunity(opportunityId: string): void {
    this.scanner.updateStatus(opportunityId, 'planned');
  }

  /**
   * 忽略机会
   */
  dismissOpportunity(opportunityId: string): void {
    this.scanner.updateStatus(opportunityId, 'dismissed');
  }
}
