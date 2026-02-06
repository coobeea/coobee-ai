import { log } from '@main/common/logger'

/**
 * 工作区路径变更事件处理器
 * 事件名: config:workspacePath:changed
 * 对应事件: EventTypes.CONFIG_WORKSPACE_PATH_CHANGED
 */
export default (payload: { path: string }): void => {
  log.info('[Event] 处理工作区路径变更事件:', payload.path)
  // TODO: 实现工作区路径切换逻辑（如果需要）
  // 可能需要重新加载工作区数据
}
