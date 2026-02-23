/**
 * Shell 相关 IPC 处理器
 *
 * - shell:get-window-info：渲染进程拉取当前窗口完整信息（windowId、tabs、currentTabId、callerTabId 等）
 */

import { ipcMain, BrowserWindow, dialog, clipboard } from 'electron';

import { log } from '../logger';
import { ShellChannels } from './channels';
import { windowManager } from '../window';
import type { WindowInfoResponse, TabInfoResponse } from '@shared/ipc';

/**
 * 注册 Shell 相关 IPC 处理器
 */
export function registerShellHandlers(): void {
  // 拉取当前窗口完整信息
  ipcMain.handle(ShellChannels.GET_WINDOW_INFO, (event): WindowInfoResponse | null => {
    // ✅ 检查 webContents 是否已销毁
    // 窗口关闭时，前端定时器可能还在调用 IPC，此时 sender 已被销毁
    // 静默返回 null，避免产生大量警告日志
    if (event.sender.isDestroyed()) {
      return null;
    }

    // 获取调用者的 webContents ID
    const callerWebContentsId = event.sender.id;

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.debug(`[IPC] shell:get-window-info - 无法获取窗口 (webContentsId=${callerWebContentsId})`);
      return null;
    }

    const windowId = win.id;
    const windowInfo = windowManager.getWindowInfo(windowId);

    if (!windowInfo) {
      log.warn(
        `[IPC] shell:get-window-info - 窗口信息不存在: windowId=${windowId}, webContentsId=${callerWebContentsId}`
      );
      return null;
    }

    // 获取调用者的 Tab ID（通过 webContents.id 查找）
    const callerTabId = windowManager.getTabIdByWebContentsId(callerWebContentsId);

    const windowTabs = windowManager.getWindowTabs(windowId);
    const tabs: TabInfoResponse[] = windowTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      isActive: tab.isActive,
      closable: tab.closable,
      position: tab.position
    }));

    const activeTab = windowManager.getActiveTab(windowId);
    const currentTabId = activeTab ? activeTab.id : null;

    const response: WindowInfoResponse = {
      windowId,
      windowType: windowInfo.type,
      tabs,
      currentTabId,
      callerTabId: callerTabId ?? null
    };
    log.debug(
      `[IPC] shell:get-window-info -> windowId=${windowId}, tabs=${tabs.length}, currentTabId=${currentTabId}, callerTabId=${callerTabId}, webContentsId=${callerWebContentsId}`
    );
    return response;
  });

  // 打开目录选择对话框
  ipcMain.handle(ShellChannels.OPEN_DIRECTORY, async (event): Promise<string | null> => {
    if (event.sender.isDestroyed()) return null;

    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // 打开文件选择对话框
  ipcMain.handle(
    ShellChannels.OPEN_FILE,
    async (
      event,
      options?: {
        properties?: Array<'openFile' | 'multiSelections'>;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ): Promise<{ canceled: boolean; filePaths: string[] }> => {
      if (event.sender.isDestroyed()) {
        return { canceled: true, filePaths: [] };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        properties: options?.properties || ['openFile'],
        filters: options?.filters
      });

      return result;
    }
  );

  // 读取剪贴板中的文件路径列表
  ipcMain.handle(ShellChannels.GET_CLIPBOARD_FILES, (): string[] => {
    try {
      // macOS: 尝试读取 public.file-url 格式
      if (process.platform === 'darwin') {
        const fileUrl = clipboard.read('public.file-url');
        if (fileUrl) {
          // 将 file:// URL 转换为路径
          const filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
          return [filePath];
        }
      }

      // Windows/Linux: 尝试读取文本格式的文件路径
      const text = clipboard.readText();
      if (text) {
        // 尝试解析为文件路径（Windows 文件路径格式：C:\... 或 \\...）
        // Linux 文件路径格式：/...
        const lines = text.split(/[\r\n]+/).filter((line) => line.trim());
        const filePaths = lines.filter((line) => {
          return /^[A-Za-z]:[\\]/.test(line) || /^\//.test(line) || /^\\\\/.test(line);
        });
        if (filePaths.length > 0) {
          return filePaths;
        }
      }

      return [];
    } catch (err) {
      log.error('[IPC] shell:get-clipboard-files - 读取剪贴板失败:', err);
      return [];
    }
  });

  log.info('[IPC] Shell handlers registered');
}
