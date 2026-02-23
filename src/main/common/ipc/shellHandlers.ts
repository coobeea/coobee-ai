/**
 * Shell 相关 IPC 处理器
 *
 * - shell:get-window-info：渲染进程拉取当前窗口完整信息（windowId、tabs、currentTabId、callerTabId 等）
 */

import { ipcMain, BrowserWindow, dialog, clipboard } from 'electron';
import { execSync } from 'child_process';

import { log } from '../logger';
import { ShellChannels } from './channels';
import { windowManager } from '../window';
import type { WindowInfoResponse, TabInfoResponse } from '@shared/ipc';

/**
 * macOS: 使用 osascript 读取剪贴板中的文件路径
 */
function getMacOSClipboardFiles(): string[] {
  try {
    // 使用 AppleScript 读取剪贴板中的文件 URL
    const script = 'the clipboard as «class furl»';
    const output = execSync(`osascript -e '${script}'`, { encoding: 'utf-8' });

    // 输出格式：«data furl...» 或多个 file:// URL
    // 解析 file:// URL
    const matches = output.match(/file:\/\/[^\s,}]+/g);
    if (matches) {
      return matches.map((url) => {
        // 移除 file:// 前缀并解码
        let path = decodeURIComponent(url.replace(/^file:\/\//, ''));
        // 移除可能的尾部换行符
        path = path.trim();
        return path;
      });
    }

    return [];
  } catch (err) {
    // osascript 执行失败（可能剪贴板中没有文件）
    log.debug('[IPC] osascript 读取剪贴板失败:', err);
    return [];
  }
}

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
  ipcMain.handle(ShellChannels.GET_CLIPBOARD_FILES, async (): Promise<string[]> => {
    try {
      const fs = await import('fs');
      const validPaths: string[] = [];

      // macOS: 使用 osascript 读取剪贴板（最可靠的方法）
      if (process.platform === 'darwin') {
        const paths = getMacOSClipboardFiles();
        log.debug('[IPC] osascript 读取到的路径:', paths);

        for (const path of paths) {
          if (fs.existsSync(path)) {
            validPaths.push(path);
          } else {
            log.warn('[IPC] 路径不存在:', path);
          }
        }

        // 如果 osascript 成功读取到路径，直接返回
        if (validPaths.length > 0) {
          log.info('[IPC] shell:get-clipboard-files -> 成功读取', validPaths.length, '个文件');
          return validPaths;
        }

        // Fallback: 尝试其他方法
        log.debug('[IPC] osascript 未读取到文件，尝试 Electron clipboard API');

        const fileUrl = clipboard.read('public.file-url');
        if (fileUrl && !fileUrl.startsWith('/.file/id=')) {
          const filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
          if (fs.existsSync(filePath)) {
            validPaths.push(filePath);
          }
        }

        const text = clipboard.readText();
        if (text && !text.startsWith('/.file/id=')) {
          const lines = text.split(/[\r\n]+/).filter((line) => line.trim());
          for (const line of lines) {
            if (/^\/[^/]/.test(line) && fs.existsSync(line)) {
              validPaths.push(line);
            }
          }
        }
      }

      // Windows/Linux: 读取文本格式的文件路径
      if (process.platform !== 'darwin') {
        const text = clipboard.readText();
        if (text) {
          const lines = text.split(/[\r\n]+/).filter((line) => line.trim());
          for (const line of lines) {
            if (/^[A-Za-z]:[\\]/.test(line) || /^\//.test(line) || /^\\\\/.test(line)) {
              if (fs.existsSync(line)) {
                validPaths.push(line);
              }
            }
          }
        }
      }

      log.info('[IPC] shell:get-clipboard-files -> 读取到', validPaths.length, '个有效路径');
      return validPaths;
    } catch (err) {
      log.error('[IPC] shell:get-clipboard-files - 读取剪贴板失败:', err);
      return [];
    }
  });

  log.info('[IPC] Shell handlers registered');
}
