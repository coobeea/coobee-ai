/**
 * Shell 相关 IPC 处理器
 *
 * - shell:get-window-info：渲染进程拉取当前窗口完整信息（windowId、tabs、currentTabId、callerTabId 等）
 */

import { ipcMain, BrowserWindow } from 'electron'

import { log } from '../logger'
import { ShellChannels } from './channels'
import { windowManager } from '../window'
import type { WindowInfoResponse, TabInfoResponse } from '@shared/ipc'

/**
 * 注册 Shell 相关 IPC 处理器
 */
export function registerShellHandlers(): void {
  // 拉取当前窗口完整信息
  ipcMain.handle(ShellChannels.GET_WINDOW_INFO, (event): WindowInfoResponse | null => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      log.warn('[IPC] shell:get-window-info - 无法获取窗口')
      return null
    }

    const windowId = win.id
    const windowInfo = windowManager.getWindowInfo(windowId)

    if (!windowInfo) {
      log.warn(`[IPC] shell:get-window-info - 窗口信息不存在: windowId=${windowId}`)
      return null
    }

    // 获取调用者的 Tab ID（通过 webContents.id 查找）
    const callerWebContentsId = event.sender.id
    const callerTabId = windowManager.getTabIdByWebContentsId(callerWebContentsId)

    const windowTabs = windowManager.getWindowTabs(windowId)
    const tabs: TabInfoResponse[] = windowTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      isActive: tab.isActive,
      closable: tab.closable,
      position: tab.position
    }))

    const activeTab = windowManager.getActiveTab(windowId)
    const currentTabId = activeTab ? activeTab.id : null

    const response: WindowInfoResponse = {
      windowId,
      windowType: windowInfo.type,
      tabs,
      currentTabId,
      callerTabId: callerTabId ?? null
    }
    log.debug(
      `[IPC] shell:get-window-info -> windowId=${windowId}, tabs=${tabs.length}, currentTabId=${currentTabId}, callerTabId=${callerTabId}`
    )
    return response
  })

  log.info('[IPC] Shell handlers registered')
}
