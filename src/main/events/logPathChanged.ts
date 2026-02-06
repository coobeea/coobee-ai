import { log } from '@main/common/logger'

/**
 * 日志路径变更事件处理器
 * 事件名: config:logPath:changed
 * 对应事件: EventTypes.CONFIG_LOG_PATH_CHANGED
 */
export default (payload: { path: string }): void => {
  log.info('[Event] 处理日志路径变更事件:', payload.path)
  log.warn('[Event] 日志路径变更需要重启应用才能生效')
  // TODO: 实现日志路径切换逻辑（如果需要）
  // Logger 需要重新初始化才能生效
}
