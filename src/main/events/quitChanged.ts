import { app } from 'electron';
import { log } from '@main/common/logger';

/**
 * 退出应用事件处理器
 * 事件名: quit:changed
 * 对应事件: EventTypes.QUIT_CHANGED
 *
 * 触发应用退出
 */
export default (): void => {
  log.info('[Event] 处理退出应用事件');

  try {
    // 直接退出应用
    // app.quit() 会触发 'before-quit' 和 'will-quit' 事件
    app.quit();
    log.info('[Event] 应用退出指令已发送');
  } catch (error) {
    log.error('[Event] 退出应用失败:', error);
  }
};
