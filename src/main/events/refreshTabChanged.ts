/**
 * 刷新标签页事件处理器
 * 事件名: refreshTab:changed
 *
 * 刷新当前焦点窗口的当前焦点标签页（F5 快捷键）
 */

import { log } from '@main/common/logger';

export default async (): Promise<void> => {
  log.info('[Event] 处理刷新标签页事件 (F5)');

  try {
    const { BrowserWindow, webContents } = await import('electron');

    // 获取当前焦点窗口
    const focusedWindow = BrowserWindow.getFocusedWindow();

    if (!focusedWindow) {
      log.warn('[Event] 没有焦点窗口，无法刷新标签页');
      return;
    }

    // 获取当前焦点的 WebContents
    const focused = webContents.getFocusedWebContents();
    if (!focused) {
      log.warn('[Event] 没有焦点 WebContents，无法刷新标签页');
      return;
    }

    // 刷新当前焦点的标签页
    focused.reload();
    log.info(`[Event] 标签页刷新成功 (F5): webContentsId=${focused.id}`);
  } catch (error) {
    log.error('[Event] 刷新标签页失败:', error);
  }
};
