import { log } from '@main/common/logger'

/**
 * 创建新窗口事件处理器
 * 事件名: newWindow:changed
 *
 * 处理逻辑：
 * 1. 调用 windowManager.createWindow() 创建新窗口
 * 2. windowManager 会自动触发 WindowEvents.WINDOW_CREATED 事件
 * 3. IpcEventBroadcaster 会自动将该事件广播到前端
 * 4. 前端监听 WINDOW_CREATED 事件更新状态
 *
 * 注意：不需要手动发送额外的 UI 事件，避免事件多次转发
 */
export default async (): Promise<void> => {
  log.info('[Event] 处理创建新窗口事件')

  try {
    const { windowManager } = await import('@main/common/window')
    const newWindow = await windowManager.createWindow({ type: 'agent' })

    if (newWindow) {
      log.info(`[Event] 新窗口创建成功: windowId=${newWindow.id}`)
      // windowManager 已经自动触发了 WINDOW_CREATED 事件
      // IpcEventBroadcaster 会自动广播到前端，无需手动发送
    } else {
      throw new Error('窗口创建失败')
    }
  } catch (error) {
    log.error('[Event] 创建新窗口失败:', error)
  }
}
