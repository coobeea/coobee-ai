/**
 * Gateway 事件桥接 — Workspace
 *
 * 将内部 EventBus 的 Workspace 文件变化事件转换为 Gateway 事件推送。
 *
 * 桥接映射：
 *   EventBus workspace:file-changed → Gateway event 'workspace.file-changed'（广播给所有客户端）
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '../protocol';

interface WorkspaceFileChangedPayload {
  threadId: string;
  files: string[];
  timestamp: number;
}

export const initWorkspaceBridge: EventBridgeInit = (gateway) => {
  const handleFileChanged = (payload: WorkspaceFileChangedPayload): void => {
    if (!payload?.threadId || !payload?.files) return;

    // 广播文件变化事件给所有客户端
    gateway.broadcastEvent('workspace.file-changed', payload);

    log.debug(`[WorkspaceBridge] 转发文件变化事件: ${payload.threadId}, ${payload.files.length} 个文件`);
  };

  eventBus.on('workspace:file-changed', handleFileChanged);

  log.info('[WorkspaceBridge] Workspace 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off('workspace:file-changed', handleFileChanged);
    log.info('[WorkspaceBridge] Workspace 事件桥接已清理');
  };
};
