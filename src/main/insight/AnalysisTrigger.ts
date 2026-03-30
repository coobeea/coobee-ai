/**
 * AnalysisTrigger — 分析触发控制
 *
 * 支持多种触发策略，可组合使用：
 *
 * 1. content  — 纯内容驱动（字符阈值 + 标点检测 + 防抖）
 * 2. smart    — 内容驱动为主 + 定时兜底（推荐，最接近"实时"体验）
 * 3. silence  — 语音静默触发 + 最小字符门槛
 * 4. interval — 固定定时 + 最小字符门槛
 * 5. hybrid   — 定时 + 静默 + 内容驱动全开
 * 6. manual   — 仅手动触发
 *
 * 内容驱动触发规则（参考 taxai ServiceFlowPanel 算法）：
 *   规则 1：增量 >= charThreshold（默认 50）→ 立即触发
 *   规则 2：增量 >= smartThreshold（默认 20）+ 末尾标点 → 立即触发
 *   规则 3：有增量 + 停止输入 debounceMs（默认 3s）→ 触发
 */

import { log } from '@main/common/logger';
import type { RefreshStrategy } from '@shared/types/insight';

const PUNCTUATION_MARKS = new Set([
  '。',
  '？',
  '！',
  '?',
  '!',
  '，',
  ',',
  '；',
  ';',
  '：',
  ':',
  '\n',
  '…',
  '~',
  '、',
  '.',
  ')'
]);

export class AnalysisTrigger {
  private strategy: RefreshStrategy;
  private onTrigger: () => Promise<void>;
  private analyzing = false;
  private hasPending = false;

  private collectionBase = 0;
  private fullText = '';

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private charThreshold: number;
  private smartThreshold: number;
  private debounceMs: number;
  private minNewChars: number;
  private useContentDriven: boolean;

  constructor(strategy: RefreshStrategy, onTrigger: () => Promise<void>) {
    this.strategy = strategy;
    this.onTrigger = onTrigger;

    this.charThreshold = strategy.charThreshold ?? 50;
    this.smartThreshold = strategy.smartThreshold ?? 20;
    this.debounceMs = strategy.debounceMs ?? 3000;
    this.minNewChars = strategy.minNewChars ?? 50;

    this.useContentDriven = ['content', 'smart', 'hybrid'].includes(strategy.trigger);

    this.startInterval();
  }

  /**
   * 文本追加时调用 — 内容驱动触发的核心入口
   */
  onTextAppended(newText: string): void {
    this.fullText += newText;

    if (!this.useContentDriven) return;

    const increment = this.getIncrement();

    this.clearDebounce();

    if (increment >= this.charThreshold) {
      log.debug(`[AnalysisTrigger] char-threshold: ${increment} >= ${this.charThreshold}`);
      this.triggerFromContent('char-threshold');
      return;
    }

    if (increment >= this.smartThreshold && this.endsWithPunctuation()) {
      log.debug(`[AnalysisTrigger] punctuation: ${increment} >= ${this.smartThreshold} + punct`);
      this.triggerFromContent('punctuation');
      return;
    }

    if (increment > 0) {
      this.debounceTimer = setTimeout(() => {
        if (this.getIncrement() > 0) {
          log.debug(`[AnalysisTrigger] debounce: ${this.getIncrement()} chars after ${this.debounceMs}ms idle`);
          this.triggerFromContent('debounce');
        }
      }, this.debounceMs);
    }
  }

  /**
   * 静默检测触发（录音模式）
   */
  onSilenceDetected(): void {
    if (this.analyzing) return;
    const t = this.strategy.trigger;
    if (t === 'silence' || t === 'hybrid') {
      this.tryTriggerLegacy('silence');
    }
  }

  /**
   * 手动触发 — 无门槛
   */
  onManualTrigger(): void {
    if (this.analyzing) {
      this.hasPending = true;
      return;
    }
    this.fire('manual');
  }

  /**
   * 兼容旧接口：更新新增字符计数（interval/silence 模式使用）
   */
  onNewTextReceived(charCount: number): void {
    if (!this.useContentDriven) {
      this.fullText = 'x'.repeat(this.collectionBase + charCount);
    }
  }

  setAnalyzing(v: boolean): void {
    this.analyzing = v;
    if (!v && this.hasPending) {
      this.hasPending = false;
      if (this.getIncrement() > 0) {
        this.fire('pending-retry');
      }
    }
  }

  destroy(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.clearDebounce();
  }

  private getIncrement(): number {
    return this.fullText.length - this.collectionBase;
  }

  private endsWithPunctuation(): boolean {
    const trimmed = this.fullText.trimEnd();
    if (!trimmed) return false;
    return PUNCTUATION_MARKS.has(trimmed[trimmed.length - 1]);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private triggerFromContent(reason: string): void {
    this.clearDebounce();
    if (this.analyzing) {
      this.hasPending = true;
      log.debug(`[AnalysisTrigger] Queued (${reason}): analysis in progress`);
      return;
    }
    this.fire(reason);
  }

  private startInterval(): void {
    const t = this.strategy.trigger;
    if (t === 'interval' || t === 'hybrid' || t === 'smart') {
      const seconds = this.strategy.intervalSeconds ?? (t === 'smart' ? 30 : 45);
      this.intervalTimer = setInterval(() => {
        if (!this.analyzing) this.tryTriggerLegacy('interval');
      }, seconds * 1000);
    }
  }

  private tryTriggerLegacy(source: string): void {
    const increment = this.getIncrement();
    if (increment < this.minNewChars) {
      log.debug(`[AnalysisTrigger] Skip (${source}): only ${increment}/${this.minNewChars} new chars`);
      return;
    }
    this.fire(source);
  }

  private fire(reason: string): void {
    log.info(`[AnalysisTrigger] FIRE (${reason}): increment=${this.getIncrement()}`);
    this.analyzing = true;
    this.collectionBase = this.fullText.length;
    this.onTrigger()
      .catch((err) => log.error('[AnalysisTrigger] Analysis failed:', err))
      .finally(() => {
        this.analyzing = false;
        if (this.hasPending && this.getIncrement() > 0) {
          this.hasPending = false;
          this.fire('pending-retry');
        }
      });
  }
}
