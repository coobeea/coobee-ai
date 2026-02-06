import { log } from '@main/common/logger'

/**
 * 新窗口变更事件处理器
 * 事件名: freshWindow:changed
 * 对应事件: EventTypes.FRESH_WINDOW_CHANGED
 *
 * 处理创建新窗口的请求
 */
export default async (): Promise<void> => {
  log.info('[Event] 处理创建新窗口事件')

  try {
    // 动态导入避免循环依赖
    const { windowManager } = await import('@main/common/window')

    // 创建新窗口
    await windowManager.createWindow({ type: 'agent' })
    log.info('[Event] 新窗口创建成功')
  } catch (error) {
    log.error('[Event] 创建新窗口失败:', error)
  }
}
