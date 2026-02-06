import { log } from '@main/common/logger'
import { BrowserWindow } from 'electron'

/**
 * 导航前进事件处理器
 * 事件名: navigationForward:changed
 * 对应事件: EventTypes.NAVIGATION_FORWARD_CHANGED
 *
 * 触发当前窗口的前进操作
 */
export default (): void => {
  log.info('[Event] 处理导航前进事件')

  try {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && focusedWindow.webContents.canGoForward()) {
      focusedWindow.webContents.goForward()
      log.info('[Event] 导航前进成功')
    } else {
      log.warn('[Event] 无法前进：没有焦点窗口或无法前进')
    }
  } catch (error) {
    log.error('[Event] 导航前进失败:', error)
  }
}
