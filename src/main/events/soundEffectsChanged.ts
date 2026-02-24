import { log } from '@main/common/logger';

/**
 * 音效设置变更事件处理器
 * 事件名: config:soundEffects:changed
 * 对应事件: EventTypes.CONFIG_SOUND_EFFECTS_CHANGED
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理音效设置变更事件:', payload.value);

  // TODO: 通知渲染进程更新音效状态
  // 可以通过 IPC 事件广播到前端
  if (payload.value) {
    log.info('[Event] 音效已启用');
  } else {
    log.info('[Event] 音效已禁用');
  }
};
