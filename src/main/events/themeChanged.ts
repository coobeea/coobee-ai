import { log } from '@main/common/logger'

/**
 * 主题变更事件处理器
 * 事件名: config:theme:changed
 * 对应事件: EventTypes.CONFIG_THEME_CHANGED
 */
export default (payload: { theme: 'light' | 'dark' | 'auto' }): void => {
  log.info('[Event] 处理主题变更事件:', payload.theme)
  // TODO: 实现主题切换逻辑（如果需要）
  // 目前主题切换已在 config.ts 中处理
}
