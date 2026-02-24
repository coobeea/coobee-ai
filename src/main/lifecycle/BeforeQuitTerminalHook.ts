import { log } from '../common/logger';
import { LifecycleHook, LifecyclePhase, LifecycleContext } from '../common/types';

/**
 * PTY 终端清理 Hook
 * 在应用退出前销毁所有 PTY 终端实例，防止游离进程
 */
export const BeforeQuitTerminalHook: LifecycleHook = {
  name: 'before-quit-terminal-cleanup',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 45,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      const { getPtyManager } = await import('../terminal/PtyManager');
      const mgr = getPtyManager();
      const count = mgr.list().length;
      if (count > 0) {
        log.info(`[BeforeQuitTerminalHook] 正在清理 ${count} 个 PTY 终端...`);
      }
      mgr.cleanup();
      log.info('[BeforeQuitTerminalHook] PTY 终端清理完成');
    } catch (error) {
      log.error('[BeforeQuitTerminalHook] PTY 终端清理失败:', error);
    }
  }
};
