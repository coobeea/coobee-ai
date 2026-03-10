import { log } from '@main/common/logger';

/**
 * 预发布版本变更事件处理器
 * 事件名: config:betaUpdates:changed
 * 对应事件: EventTypes.CONFIG_BETA_UPDATES_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理预发布版本变更事件:', payload.value);
  // TODO: 配置更新通道（stable / beta）
  // 需要配合 electron-updater 的 channel 设置
};
