import { log } from '../common/logger';
import { LifecycleHook, LifecyclePhase, LifecycleContext } from '../common/types';

/**
 * StreamStore 退出清理 Hook
 *
 * 在应用退出前刷新 StreamStore 的消息队列并停止定时器，
 * 确保未持久化的流式消息不会丢失。
 */
export const BeforeQuitStreamStoreHook: LifecycleHook = {
  name: 'before-quit-stream-store',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 60, // 在进程清理(50)之后、数据库清理(100)之前

  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      const { streamStore } = await import('../ai/streaming/consumers/StreamStore');
      await streamStore.destroy();
      log.info('[BeforeQuitStreamStoreHook] StreamStore 已销毁，队列已刷新');
    } catch (error) {
      log.error('[BeforeQuitStreamStoreHook] StreamStore 销毁失败:', error);
    }
  }
};
