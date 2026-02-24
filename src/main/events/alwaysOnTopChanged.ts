import { BrowserWindow } from 'electron';
import { log } from '@main/common/logger';

/**
 * 窗口置顶变更事件处理器
 * 事件名: config:alwaysOnTop:changed
 * 对应事件: EventTypes.CONFIG_ALWAYS_ON_TOP_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理窗口置顶变更事件:', payload.value);

  try {
    // 获取所有 BrowserWindow 实例并设置置顶状态
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.setAlwaysOnTop(payload.value);
        log.debug(`[Event] 窗口 ${window.id} 置顶状态已更新: ${payload.value}`);
      }
    });

    log.info(`[Event] 已更新 ${allWindows.length} 个窗口的置顶状态`);
  } catch (error) {
    log.error('[Event] 处理窗口置顶变更失败:', error);
  }
};
