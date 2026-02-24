import { log } from '@main/common/logger';

/**
 * 备份路径变更事件处理器
 * 事件名: config:backupPath:changed
 * 对应事件: EventTypes.CONFIG_BACKUP_PATH_CHANGED
 */
export default (payload: { path: string }): void => {
  log.info('[Event] 处理备份路径变更事件:', payload.path);
  // TODO: 实现备份路径切换逻辑（如果需要）
  // 可能需要迁移现有备份文件
};
