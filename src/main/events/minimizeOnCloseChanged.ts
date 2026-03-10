import { log } from '@main/common/logger';

/**
 * 关闭时最小化到托盘变更事件处理器
 * 事件名: config:minimizeOnClose:changed
 * 对应事件: EventTypes.CONFIG_MINIMIZE_ON_CLOSE_CHANGED
 *
 * 注意：这个设置在窗口关闭时生效，运行时不需要特殊处理
 * 与 closeToTray 类似，逻辑已在 WindowManager 的 CLOSE 事件中处理
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 关闭时最小化到托盘配置已更新:', payload.value);
  // 无需额外处理，配置已保存，在窗口关闭时生效
};
