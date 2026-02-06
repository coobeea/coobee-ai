import { log } from '@main/common/logger'
import { app } from 'electron'
/**
 * 工作区路径变更事件处理器
 * 事件名: config:workspacePath:changed
 * 对应事件: EventTypes.CONFIG_WORKSPACE_PATH_CHANGED
 */
export default (payload: { path: string }): void => {
  log.info('[Event] 处理工作区路径变更事件:', payload.path)
  app.setPath('userData', payload.path)
}
