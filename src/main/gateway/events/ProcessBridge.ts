/**
 * Gateway 事件桥接 — Process
 *
 * 将 ProcessRegistry 的进程输出和状态变化事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   ProcessRegistry process:output → Gateway event 'process.output'
 *   ProcessRegistry process:exit   → Gateway event 'process.exit'
 */

import { log } from '@main/common/logger';
import { ProcessRegistry } from '@main/ai/process/ProcessRegistry';
import type { EventBridgeInit } from '../protocol';

export const initProcessBridge: EventBridgeInit = (gateway) => {
  const registry = ProcessRegistry.getInstance();

  const handleOutput = (event: { processId: string; text: string }): void => {
    gateway.broadcastEvent('process.output', event);
  };

  const handleExit = (event: { processId: string; status: string; exitCode: number | null }): void => {
    gateway.broadcastEvent('process.exit', event);
  };

  registry.on('process:output', handleOutput);
  registry.on('process:exit', handleExit);

  log.info('[ProcessBridge] Process 事件桥接初始化完成');

  return () => {
    registry.off('process:output', handleOutput);
    registry.off('process:exit', handleExit);
    log.info('[ProcessBridge] Process 事件桥接已清理');
  };
};
