import { log } from '@main/common/logger'

/**
 * 目录创建事件处理器
 * 事件名: directory:created:changed
 * 对应事件: EventTypes.DIRECTORY_CREATED
 *
 * 当新目录被创建时触发
 */
export default (payload: { directoryId: string; path: string; userId: string }): void => {
  log.info('[Event] 处理目录创建事件:', payload)
  // TODO: 如果启用目录监控，添加到监控列表
  // TODO: 通知相关服务目录已创建
}
