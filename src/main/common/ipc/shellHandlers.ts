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
 * macOS: 解析 plist XML 格式的文件路径列表
 */
function parsePlistFilePaths(plistXml: string): string[] {
  try {
    // 简单的正则解析，提取所有 <string>...</string> 标签中的内容
    const stringPattern = /<string>([^<]+)<\/string>/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = stringPattern.exec(plistXml)) !== null) {
      const path = match[1].trim();
      if (path.startsWith('/') || path.startsWith('~')) {
        paths.push(path);
      }
    }

    return paths;
  } catch (err) {
    log.error('[IPC] 解析 plist 失败:', err);
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

      // macOS: 使用 NSFilenamesPboardType（最可靠）
      if (process.platform === 'darwin') {
        try {
          // 方法1: NSFilenamesPboardType（plist 格式，支持多个文件和中文路径）
          const buffer = clipboard.readBuffer('NSFilenamesPboardType');
          if (buffer && buffer.length > 0) {
            const plistXml = buffer.toString('utf-8');
            log.debug('[IPC] NSFilenamesPboardType 长度:', buffer.length);

            const paths = parsePlistFilePaths(plistXml);
            log.info('[IPC] 从 plist 中解析到', paths.length, '个路径');

            for (const path of paths) {
              if (fs.existsSync(path)) {
                validPaths.push(path);
              } else {
                log.warn('[IPC] 路径不存在:', path);
              }
            }

            if (validPaths.length > 0) {
              log.info('[IPC] 成功读取', validPaths.length, '个文件路径');
              return validPaths;
            }
          }
        } catch (err) {
          log.debug('[IPC] NSFilenamesPboardType 读取失败:', err);
        }

        // 方法2: public.file-url（单个文件）
        try {
          const fileUrl = clipboard.read('public.file-url');
          if (fileUrl && !fileUrl.startsWith('/.file/id=')) {
            const filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
            if (fs.existsSync(filePath)) {
              log.info('[IPC] 通过 public.file-url 读取到文件:', filePath);
              return [filePath];
            }
          }
        } catch (_e) {
          // public.file-url 不可用
        }

        log.info('[IPC] 剪贴板中没有文件');
        return [];
      }

      // Windows/Linux: 读取文本格式的文件路径
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

      if (validPaths.length > 0) {
        log.info('[IPC] 成功读取', validPaths.length, '个文件路径');
      } else {
        log.info('[IPC] 剪贴板中没有文件');
      }

      return validPaths;
    } catch (err) {
      log.error('[IPC] shell:get-clipboard-files - 读取剪贴板失败:', err);
      return [];
    }
  });

  log.info('[IPC] Shell handlers registered');
}
