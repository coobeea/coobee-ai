import { log } from '@main/common/logger'

/**
 * 语言变更事件处理器
 * 事件名: config:language:changed
 * 对应事件: EventTypes.CONFIG_LANGUAGE_CHANGED
 */
export default (payload: { language: string }): void => {
  log.info('[Event] 处理语言变更事件:', payload.language)
  // TODO: 实现国际化切换逻辑（如果需要）
  // 可能需要通知前端重新加载语言包
}
