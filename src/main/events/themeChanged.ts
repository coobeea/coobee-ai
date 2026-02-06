import { log } from '@main/common/logger'
import themeManager from '@main/common/theme'

/**
 * 主题变更事件处理器
 * 事件名: config:theme:changed
 * 对应事件: EventTypes.CONFIG_THEME_CHANGED
 */
export default (payload: { theme: 'light' | 'dark' | 'auto' }): void => {
  log.info('[Event] 处理主题变更事件:', payload.theme)
  themeManager.setTheme(payload.theme)
}
