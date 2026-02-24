/**
 * Gateway 事件桥接 — Terminal
 *
 * 将 PtyManager 的终端输出和退出事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   PtyManager terminal:output → Gateway event 'terminal.output'
 *   PtyManager terminal:exit   → Gateway event 'terminal.exit'
 */

import { log } from '@main/common/logger';
import { getPtyManager } from '@main/terminal/PtyManager';
import type { EventBridgeInit } from '../protocol';

export const initTerminalBridge: EventBridgeInit = (gateway) => {
  const ptyManager = getPtyManager();

  const handleOutput = (event: { terminalId: string; data: string }): void => {
    gateway.broadcastEvent('terminal.output', event);
  };

  const handleExit = (event: { terminalId: string; exitCode: number; signal?: number }): void => {
    gateway.broadcastEvent('terminal.exit', event);
  };

  ptyManager.on('terminal:output', handleOutput);
  ptyManager.on('terminal:exit', handleExit);

  log.info('[TerminalBridge] Terminal 事件桥接初始化完成');

  return () => {
    ptyManager.off('terminal:output', handleOutput);
    ptyManager.off('terminal:exit', handleExit);
    log.info('[TerminalBridge] Terminal 事件桥接已清理');
  };
};
