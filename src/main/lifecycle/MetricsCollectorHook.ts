/**
 * MetricsCollector 生命周期钩子
 *
 * 职责：
 * - 在 READY 阶段初始化 MetricsCollector
 */

import { log } from '@main/common/logger';
import { LifecyclePhase, type LifecycleHook } from '@main/common/types';
import { initializeMetricsCollector } from '@main/metrics/MetricsCollector';

export const MetricsCollectorInitHook: LifecycleHook = {
  name: 'metrics-collector-init',
  phase: LifecyclePhase.READY,
  priority: 24, // 在 BrainMetrics 之前
  critical: false,

  async execute() {
    try {
      log.info('[MetricsCollectorHook] 初始化 MetricsCollector...');

      await initializeMetricsCollector();

      log.info('[MetricsCollectorHook] MetricsCollector 初始化完成');
    } catch (error) {
      log.error('[MetricsCollectorHook] MetricsCollector 初始化失败', error);
      throw error;
    }
  }
};
