/**
 * 刷新当前页面事件处理器
 *
 * 刷新当前焦点窗口的当前焦点标签页
 */

import { log } from '@main/common/logger'

export default async (): Promise<void> => {
  log.info('[Event] 处理刷新页面事件')

  try {
    const { BrowserWindow, webContents } = await import('electron')

    // 获取当前焦点窗口
    const focusedWindow = BrowserWindow.getFocusedWindow()

    if (!focusedWindow) {
      log.warn('[Event] 没有焦点窗口，无法刷新页面')
      return
    }

    // 获取当前焦点的 WebContents
    const focused = webContents.getFocusedWebContents()
    if (!focused) {
      log.warn('[Event] 没有焦点 WebContents，无法刷新页面')
      return
    }

    // 刷新当前焦点的标签页
    focused.reload()
    log.info(`[Event] 页面刷新成功: webContentsId=${focused.id}`)
  } catch (error) {
    log.error('[Event] 刷新页面失败:', error)
  }
}
