import { log } from '@main/common/logger'
import { EventTypes } from '@shared/ipc/events'

/**
 * 创建新窗口事件处理器
 * 事件名: newWindow:changed
 *
 * 处理逻辑：通过 EventBus 发送 UI_CREATE_WINDOW 事件到前端
 * 前端 EventBus 接收后可以显示创建窗口的提示或执行相关 UI 操作
 *
 * 注意：实际窗口创建由后端直接执行（windowManager.createWindow）
 */
export default async (): Promise<void> => {
  log.info('[Event] 处理创建新窗口事件')

  try {
    // 1. 创建新窗口
    const { windowManager } = await import('@main/common/window')
    const newWindow = await windowManager.createWindow({ type: 'agent' })

    if (newWindow) {
      log.info(`[Event] 新窗口创建成功: windowId=${newWindow.id}`)

      // 2. 发送 UI 事件到前端（可选，用于前端显示提示等）
      const { eventBus } = await import('@main/common/eventbus')
      eventBus.emit(EventTypes.UI_CREATE_WINDOW, {
        timestamp: Date.now()
      })

      log.info('[Event] UI_CREATE_WINDOW 事件已发送到前端')
    } else {
      throw new Error('窗口创建失败')
    }
  } catch (error) {
    log.error('[Event] 创建新窗口失败:', error)
  }
}
