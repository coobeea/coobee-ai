/**
 * Shell 相关 IPC 处理器
 *
 * - shell:get-window-id：渲染进程拉取当前窗口 ID
 * - shell:chrome-height：渲染进程上报 Chrome 高度（预留，用于后续 WebContentsView 布局）
 */

import { ipcMain, BrowserWindow } from 'electron'

import { log } from '../logger'
import { ShellChannels } from './channels'

/**
 * 注册 Shell 相关 IPC 处理器
 */
export function registerShellHandlers(): void {
  // 拉取当前窗口 ID
  ipcMain.handle(ShellChannels.GET_WINDOW_ID, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const id = win ? win.id : 0
    log.debug(`[IPC] shell:get-window-id -> ${id}`)
    return id
  })

  // 接收渲染进程上报的 Chrome 高度（预留）
  ipcMain.on(ShellChannels.CHROME_HEIGHT, (event, payload: { height: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const height = payload?.height ?? 0
    log.debug(`[IPC] shell:chrome-height windowId=${win.id} height=${height}`)
    // TODO: 可用于更新 WebContentsView 的 y/height，或通知其他模块
  })

  log.info('[IPC] Shell handlers registered')
}
