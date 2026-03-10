/**
 * Brain Metrics 生命周期钩子
 *
 * 职责：
 * - 在 READY 阶段初始化 BrainMetrics
 *
 * 注意：实际的工具调用监控需要通过 Extension 系统实现
 * 见 docs/8.strategic-planning/04-brain-skill-auto-integration.md
 */

import { log } from '@main/common/logger';
import { LifecyclePhase, type LifecycleHook } from '@main/common/types';
import { initializeBrainMetrics } from '@main/ai/metrics/BrainMetrics';

export const BrainMetricsInitHook: LifecycleHook = {
  name: 'brain-metrics-init',
  phase: LifecyclePhase.READY,
  priority: 25, // 在 Gateway 之前
  critical: false,

  async execute() {
    try {
      log.info('[BrainMetricsHook] 初始化 Brain 监控...');

      // 初始化 BrainMetrics
      await initializeBrainMetrics();

      log.info('[BrainMetricsHook] Brain 监控初始化完成');
      log.info('[BrainMetricsHook] 提示：需要创建 Extension 来监控工具调用（见 BrainMetricsHook.ts 实现参考）');
    } catch (error) {
      log.error('[BrainMetricsHook] Brain 监控初始化失败', error);
      throw error;
    }
  }
};
