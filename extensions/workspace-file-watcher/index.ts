/**
 * Workspace File Watcher Extension - 入口文件
 *
 * 监控 Agent 工作空间文件变化并实时推送到前端。
 */

import type { ExtensionModule } from '../../src/main/common/extension';
import { WorkspaceFileWatcher } from './WorkspaceFileWatcher';

export const extension: ExtensionModule = {
  id: 'workspace-file-watcher',
  name: 'Workspace File Watcher',

  async register(api) {
    const { logger, eventBus } = api;

    logger.info('Initializing Workspace File Watcher...');

    // 初始化并启动监控
    const watcher = WorkspaceFileWatcher.getInstance();
    await watcher.start(logger, eventBus);

    logger.info('Workspace File Watcher started successfully');
  },

  unregister() {
    // 清理所有资源：EventBus 监听器 + FSWatcher + Timer
    const watcher = WorkspaceFileWatcher.getInstance();
    watcher.stop();
  }
};

export default extension;
