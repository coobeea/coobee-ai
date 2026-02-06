/**
 * 创建新标签页事件处理器
 * 事件名: newTab:changed
 *
 * 在当前焦点窗口创建一个新的标签页
 */

import { log } from '@main/common/logger'

export default async (): Promise<void> => {
  log.info('[Event] 处理创建新标签页事件')

  try {
    const { windowManager } = await import('@main/common/window')
    const { BrowserWindow } = await import('electron')

    // 获取当前焦点窗口
    const focusedWindow = BrowserWindow.getFocusedWindow()

    if (!focusedWindow) {
      log.warn('[Event] 没有焦点窗口，无法创建新标签页')
      return
    }

    // 获取窗口 ID
    const windowId = focusedWindow.id

    // 在当前窗口创建新标签页
    const tabId = await windowManager.createTab(windowId, {
      url: 'https://www.google.com' // 默认打开 Google
    })

    if (tabId) {
      log.info(`[Event] 新标签页创建成功: windowId=${windowId}, tabId=${tabId}`)
    } else {
      throw new Error('标签页创建失败')
    }
  } catch (error) {
    log.error('[Event] 创建新标签页失败:', error)
  }
}
