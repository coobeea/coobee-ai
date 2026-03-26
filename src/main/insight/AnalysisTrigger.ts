/**
 * AnalysisTrigger — 分析触发控制
 *
 * 根据刷新策略决定何时触发一次分析。
 * 支持静音检测、定时、手动和混合模式。
 */

import { log } from '@main/common/logger';
import type { RefreshStrategy } from '@shared/types/insight';

export class AnalysisTrigger {
  private strategy: RefreshStrategy;
  private onTrigger: () => Promise<void>;
  private analyzing = false;
  private newCharCount = 0;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(strategy: RefreshStrategy, onTrigger: () => Promise<void>) {
    this.strategy = strategy;
    this.onTrigger = onTrigger;
    this.startInterval();
  }

  onSilenceDetected(): void {
    if (this.analyzing) return;
    const trigger = this.strategy.trigger;
    if (trigger === 'silence' || trigger === 'hybrid') {
      this.tryTrigger('silence');
    }
  }

  onNewTextReceived(charCount: number): void {
    this.newCharCount = charCount;
  }

  onManualTrigger(): void {
    if (this.analyzing) return;
    this.fire();
  }

  setAnalyzing(v: boolean): void {
    this.analyzing = v;
  }

  destroy(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private startInterval(): void {
    const trigger = this.strategy.trigger;
    if (trigger === 'interval' || trigger === 'hybrid') {
      const seconds = this.strategy.intervalSeconds ?? 45;
      this.intervalTimer = setInterval(() => {
        if (!this.analyzing) this.tryTrigger('interval');
      }, seconds * 1000);
    }
  }

  private tryTrigger(source: string): void {
    const minChars = this.strategy.minNewChars ?? 50;
    if (this.newCharCount < minChars) {
      log.debug(`[AnalysisTrigger] Skip (${source}): only ${this.newCharCount}/${minChars} new chars`);
      return;
    }
    this.fire();
  }

  private fire(): void {
    this.analyzing = true;
    this.onTrigger()
      .catch((err) => log.error('[AnalysisTrigger] Analysis failed:', err))
      .finally(() => {
        this.analyzing = false;
      });
  }
}
