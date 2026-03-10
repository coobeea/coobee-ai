import { log } from '@main/common/logger';

/**
 * 显示托盘图标变更事件处理器
 * 事件名: config:showTrayIcon:changed
 * 对应事件: EventTypes.CONFIG_SHOW_TRAY_ICON_CHANGED
 */
export default async (payload: { value: boolean }): Promise<void> => {
  log.info('[Event] 处理显示托盘图标变更事件:', payload.value);

  try {
    // 动态导入避免循环依赖
    const { trayManager } = await import('@main/common/tray');

    if (payload.value) {
      trayManager.createTray();
      log.info('[Event] 托盘图标已创建');
    } else {
      trayManager.destroy();
      log.info('[Event] 托盘图标已销毁');
    }
  } catch (error) {
    log.error('[Event] 处理托盘图标变更失败:', error);
  }
};
