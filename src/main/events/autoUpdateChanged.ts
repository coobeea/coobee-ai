import { log } from '@main/common/logger';

/**
 * 自动更新变更事件处理器
 * 事件名: config:autoUpdate:changed
 * 对应事件: EventTypes.CONFIG_AUTO_UPDATE_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理自动更新变更事件:', payload.value);
  // TODO: 启用或禁用自动更新检查
  // 可能需要集成 electron-updater
};
