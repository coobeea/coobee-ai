import { log } from '@main/common/logger'

/**
 * 目录删除事件处理器
 * 事件名: directory:deleted:changed
 * 对应事件: EventTypes.DIRECTORY_DELETED
 *
 * 当目录被删除时触发
 */
export default (payload: { directoryId: string; path: string; userId: string }): void => {
  log.info('[Event] 处理目录删除事件:', payload)
  // TODO: 如果目录在监控中，从监控列表移除
  // TODO: 清理相关数据
}
