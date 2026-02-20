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

    // Extension 卸载时清理资源（虽然目前没有热卸载机制，但保持良好实践）
    // 可在未来支持 Extension 热重载时使用
  }
};

export default extension;
