import { log } from '@main/common/logger'

/**
 * 关闭到托盘变更事件处理器
 * 事件名: config:closeToTray:changed
 * 对应事件: EventTypes.CONFIG_CLOSE_TO_TRAY_CHANGED
 *
 * 注意：关闭到托盘的逻辑已在 WindowManager 的 CLOSE 事件中处理
 * 这里不需要额外处理，配置变更后会自动在下次窗口关闭时生效
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 关闭到托盘配置已更新:', payload.value)
  // 无需额外处理，配置已保存
}
