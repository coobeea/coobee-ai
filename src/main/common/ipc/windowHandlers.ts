/**
 * 窗口控制 IPC 处理器
 *
 * 渲染进程发送 window:minimize / maximize / close，主进程执行对应操作
 */

import { ipcMain, BrowserWindow } from 'electron';

import { log } from '../logger';
import { WindowChannels } from './channels';

/**
 * 注册窗口控制 IPC 处理器
 */
export function registerWindowHandlers(): void {
  // 最小化
  ipcMain.on(WindowChannels.MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.minimize();
      log.debug(`[IPC] window:minimize windowId=${win.id}`);
    }
  });

  // 最大化/还原
  ipcMain.on(WindowChannels.MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
        log.debug(`[IPC] window:unmaximize windowId=${win.id}`);
      } else {
        win.maximize();
        log.debug(`[IPC] window:maximize windowId=${win.id}`);
      }
    }
  });

  // 关闭
  ipcMain.on(WindowChannels.CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      log.debug(`[IPC] window:close windowId=${win.id}`);
      win.close();
    }
  });

  log.info('[IPC] Window handlers registered');
}
