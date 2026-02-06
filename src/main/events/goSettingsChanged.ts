import { log } from '@main/common/logger'
import { EventTypes } from '@shared/ipc/events'

/**
 * 跳转到设置页事件处理器
 * 事件名: goSettings:changed
 *
 * 处理逻辑：通过 EventBus 发送 UI_GO_SETTINGS 事件到前端
 * 前端 EventBus 接收后执行路由跳转到设置页
 */
export default async (): Promise<void> => {
  log.info('[Event] 处理跳转到设置页事件')

  try {
    // 动态导入避免循环依赖
    const { eventBus } = await import('@main/common/eventbus')

    // 发送 UI 事件到前端
    eventBus.emit(EventTypes.UI_GO_SETTINGS, {
      timestamp: Date.now()
    })

    log.info('[Event] UI_GO_SETTINGS 事件已发送到前端')
  } catch (error) {
    log.error('[Event] 跳转到设置页失败:', error)
  }
}
