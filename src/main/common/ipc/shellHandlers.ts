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
 * macOS: 使用 Node.js child_process 读取剪贴板中的文件路径
 * 参考 VSCode 的实现方式
 */
function getMacOSClipboardFiles(): string[] {
  try {
    // 方法1: 读取 NSFilenamesPboardType（macOS 专用格式）
    // 使用 pbpaste 和 osascript 组合
    const script = `
      set theFiles to {}
      try
        set theFiles to the clipboard as «class furl»
        set output to ""
        repeat with aFile in theFiles
          set output to output & POSIX path of aFile & linefeed
        end repeat
        return output
      end try
    `.replace(/\n/g, ' ');

    const output = execSync(`osascript -e '${script}'`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024 // 10MB
    }).trim();

    if (output) {
      const paths = output
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      log.debug('[IPC] osascript 读取到路径:', paths);
      return paths;
    }

    return [];
  } catch (_err) {
    log.debug('[IPC] osascript 读取剪贴板失败，可能剪贴板中没有文件');
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

      // 调试：查看剪贴板中所有可用格式
      const formats = clipboard.availableFormats();
      log.info('[IPC] 剪贴板可用格式:', formats);

      // macOS: 尝试多种方法
      if (process.platform === 'darwin') {
        // 方法1: 读取所有可能的格式
        for (const format of formats) {
          log.debug('[IPC] 尝试读取格式:', format);
          try {
            const content = clipboard.read(format);
            log.debug('[IPC] 格式', format, '内容:', content.substring(0, 200));
          } catch (_e) {
            log.debug('[IPC] 读取格式', format, '失败');
          }
        }

        // 方法2: 使用 osascript
        const paths = getMacOSClipboardFiles();
        log.info('[IPC] osascript 读取到的路径:', paths);

        for (const path of paths) {
          if (fs.existsSync(path)) {
            validPaths.push(path);
          } else {
            log.warn('[IPC] 路径不存在:', path);
          }
        }

        if (validPaths.length > 0) {
          log.info('[IPC] 成功读取', validPaths.length, '个有效文件');
          return validPaths;
        }

        // 方法3: Electron API fallback
        log.info('[IPC] osascript 未读取到文件，尝试 Electron API');

        // 尝试 public.file-url
        if (formats.includes('public.file-url')) {
          const fileUrl = clipboard.read('public.file-url');
          log.info('[IPC] public.file-url 内容:', fileUrl);
          if (fileUrl && !fileUrl.startsWith('/.file/id=')) {
            const filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
            if (fs.existsSync(filePath)) {
              validPaths.push(filePath);
            }
          }
        }

        // 尝试 NSFilenamesPboardType
        if (formats.includes('NSFilenamesPboardType')) {
          const buffer = clipboard.readBuffer('NSFilenamesPboardType');
          log.info('[IPC] NSFilenamesPboardType buffer 长度:', buffer.length);
          log.info('[IPC] NSFilenamesPboardType 内容:', buffer.toString('utf-8').substring(0, 500));
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

      log.info('[IPC] 最终读取到', validPaths.length, '个有效路径');
      return validPaths;
    } catch (err) {
      log.error('[IPC] shell:get-clipboard-files - 读取剪贴板失败:', err);
      return [];
    }
  });

  log.info('[IPC] Shell handlers registered');
}
