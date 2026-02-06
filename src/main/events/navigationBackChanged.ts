import { log } from '@main/common/logger'
import { BrowserWindow } from 'electron'

/**
 * 导航后退事件处理器
 * 事件名: navigationBack:changed
 * 对应事件: EventTypes.NAVIGATION_BACK_CHANGED
 *
 * 触发当前窗口的后退操作
 */
export default (): void => {
  log.info('[Event] 处理导航后退事件')

  try {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && focusedWindow.webContents.canGoBack()) {
      focusedWindow.webContents.goBack()
      log.info('[Event] 导航后退成功')
    } else {
      log.warn('[Event] 无法后退：没有焦点窗口或无法后退')
    }
  } catch (error) {
    log.error('[Event] 导航后退失败:', error)
  }
}
