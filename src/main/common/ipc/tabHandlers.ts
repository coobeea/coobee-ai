/**
 * Tab 相关 IPC 处理器
 *
 * 处理渲染进程发起的 Tab 操作请求：
 * - tab:create - 创建新 Tab
 * - tab:close - 关闭 Tab
 * - tab:switch - 切换 Tab
 * - tab:update - 更新 Tab 信息
 */

import { ipcMain, BrowserWindow } from 'electron';

import { log } from '../logger';
import { TabChannels } from './channels';
import { windowManager } from '../window';
import type {
  CreateTabRequest,
  CreateTabResponse,
  CloseTabRequest,
  SwitchTabRequest,
  UpdateTabRequest,
  IpcResult
} from '@shared/ipc';

/**
 * 注册 Tab 相关 IPC 处理器
 */
export function registerTabHandlers(): void {
  // 创建 Tab
  ipcMain.handle(TabChannels.CREATE, async (event, req: CreateTabRequest): Promise<IpcResult<CreateTabResponse>> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.warn('[IPC] tab:create - 无法获取窗口');
      return { success: false, error: '无法获取窗口' };
    }

    const windowId = win.id;
    if (req.windowId !== undefined && req.windowId !== windowId) {
      log.warn(`[IPC] tab:create - 试图跨窗口操作被拒绝: 来源=${windowId}, 目标=${req.windowId}`);
      return { success: false, error: '无权操作其他窗口的 Tab' };
    }

    try {
      log.info(`[IPC] tab:create - windowId=${windowId}, title="${req.title}"`);

      // 使用 WindowManager 创建 Tab
      const tabId = await windowManager.createTab(windowId, {
        title: req.title,
        url: req.url,
        active: req.isActive ?? true,
        closable: req.closable ?? true
      });

      if (!tabId) {
        throw new Error('创建 Tab 失败');
      }

      // 获取创建的 Tab 信息
      const windowInfo = windowManager.getWindowInfo(windowId);
      const tab = windowInfo?.tabs.get(tabId);

      if (!tab) {
        throw new Error('无法获取 Tab 信息');
      }

      log.info(`[IPC] tab:create - 成功创建 Tab: tabId=${tabId}`);

      return {
        success: true,
        data: {
          tabId,
          tab: {
            id: tabId,
            title: tab.title,
            url: tab.url,
            isActive: tab.isActive,
            closable: tab.closable,
            position: tab.position,
            type: req.type
          }
        }
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('[IPC] tab:create - 失败:', error);
      return { success: false, error: errMsg };
    }
  });

  // 关闭 Tab
  ipcMain.handle(TabChannels.CLOSE, async (event, req: CloseTabRequest): Promise<IpcResult<void>> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.warn('[IPC] tab:close - 无法获取窗口');
      return { success: false, error: '无法获取窗口' };
    }

    const windowId = win.id;
    if (req.windowId !== undefined && req.windowId !== windowId) {
      log.warn(`[IPC] tab:close - 试图跨窗口操作被拒绝: 来源=${windowId}, 目标=${req.windowId}`);
      return { success: false, error: '无权操作其他窗口的 Tab' };
    }

    try {
      log.info(`[IPC] tab:close - windowId=${windowId}, tabId=${req.tabId}`);

      await windowManager.closeTab(windowId, req.tabId);

      log.info(`[IPC] tab:close - 成功关闭 Tab: tabId=${req.tabId}`);

      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('[IPC] tab:close - 失败:', error);
      return { success: false, error: errMsg };
    }
  });

  // 切换 Tab
  ipcMain.handle(TabChannels.SWITCH, async (event, req: SwitchTabRequest): Promise<IpcResult<void>> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.warn('[IPC] tab:switch - 无法获取窗口');
      return { success: false, error: '无法获取窗口' };
    }

    const windowId = win.id;
    if (req.windowId !== undefined && req.windowId !== windowId) {
      log.warn(`[IPC] tab:switch - 试图跨窗口操作被拒绝: 来源=${windowId}, 目标=${req.windowId}`);
      return { success: false, error: '无权操作其他窗口的 Tab' };
    }

    try {
      log.info(`[IPC] tab:switch - windowId=${windowId}, tabId=${req.tabId}`);

      await windowManager.switchTab(windowId, req.tabId);

      log.info(`[IPC] tab:switch - 成功切换 Tab: tabId=${req.tabId}`);

      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('[IPC] tab:switch - 失败:', error);
      return { success: false, error: errMsg };
    }
  });

  // 更新 Tab
  ipcMain.handle(TabChannels.UPDATE, async (event, req: UpdateTabRequest): Promise<IpcResult<void>> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.warn('[IPC] tab:update - 无法获取窗口');
      return { success: false, error: '无法获取窗口' };
    }

    const windowId = win.id;
    if (req.windowId !== undefined && req.windowId !== windowId) {
      log.warn(`[IPC] tab:update - 试图跨窗口操作被拒绝: 来源=${windowId}, 目标=${req.windowId}`);
      return { success: false, error: '无权操作其他窗口的 Tab' };
    }

    try {
      log.info(`[IPC] tab:update - windowId=${windowId}, tabId=${req.tabId}`);

      // 调用 WindowManager 更新 Tab
      const success = windowManager.updateTab(windowId, req.tabId, {
        title: req.title,
        url: req.url
      });

      if (!success) {
        throw new Error('更新 Tab 失败');
      }

      log.info(`[IPC] tab:update - 成功更新 Tab: tabId=${req.tabId}`);

      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('[IPC] tab:update - 失败:', error);
      return { success: false, error: errMsg };
    }
  });

  log.info('[IPC] Tab handlers registered');
}
