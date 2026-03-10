/**
 * 快捷键配置变更事件处理器
 *
 * 当快捷键配置发生变化时，刷新快捷键注册
 */

import { log } from '@main/common/logger';

export default async (): Promise<void> => {
  log.info('[Event] 处理快捷键配置变更事件');

  try {
    const { shortcutManager } = await import('@main/common/shortcut');
    await shortcutManager.refreshShortcuts();
    log.info('[Event] 快捷键已刷新');
  } catch (error) {
    log.error('[Event] 刷新快捷键失败:', error);
  }
};
