/**
 * 模式切换事件桥接
 *
 * 当 Agent 调用 switch_to_orchestration 工具时，
 * 将切换请求事件转发给前端，让前端重新提交消息到 orchestrator 模式。
 */

import { createLogger } from '@main/common/logger';
import type { EventBridgeInit } from '../protocol';
import { eventBus } from '@main/common/eventbus';

const log = createLogger('gateway:mode-switch-bridge');

export const initModeSwitchBridge: EventBridgeInit = (gateway) => {
  const handler = (data: Record<string, unknown>): void => {
    log.info('[ModeSwitchBridge] Mode switch requested:', data);

    // 转发给前端
    gateway.broadcastEvent('mode.switch-requested', data);
  };

  eventBus.on('agent:mode-switch-requested', handler);
  log.info('[ModeSwitchBridge] Initialized');

  return () => {
    eventBus.off('agent:mode-switch-requested', handler);
    log.info('[ModeSwitchBridge] Cleaned up');
  };
};
