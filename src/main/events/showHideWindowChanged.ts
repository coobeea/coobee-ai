import { log } from '@main/common/logger';

/**
 * 显示/隐藏窗口变更事件处理器
 * 事件名: showHideWindow:changed
 * 对应事件: EventTypes.SHOW_HIDE_WINDOW_CHANGED
 *
 * 实现窗口的显示/隐藏切换功能（常用于全局快捷键）
 */
export default async (): Promise<void> => {
  log.info('[Event] 处理显示/隐藏窗口事件');

  try {
    // 动态导入避免循环依赖
    const { windowManager } = await import('@main/common/window');
    const mainWindow = windowManager.getMainWindow();

    if (!mainWindow) {
      log.warn('[Event] 主窗口不存在，无法执行显示/隐藏操作');
      return;
    }

    // 判断窗口当前状态
    const isVisible = mainWindow.isVisible();
    const isMinimized = mainWindow.isMinimized();

    if (!isVisible || isMinimized) {
      // 窗口当前不可见或最小化，显示窗口
      log.info('[Event] 窗口当前不可见，正在显示窗口');

      if (isMinimized) {
        mainWindow.restore();
      }

      mainWindow.show();
      mainWindow.focus();

      log.info('[Event] 窗口已显示并获得焦点');
    } else {
      // 窗口当前可见，隐藏窗口
      log.info('[Event] 窗口当前可见，正在隐藏窗口');
      mainWindow.hide();
      log.info('[Event] 窗口已隐藏');
    }
  } catch (error) {
    log.error('[Event] 处理显示/隐藏窗口事件失败:', error);
  }
};
