/**
 * Gateway 事件桥接 — Agent Event
 *
 * 将 Agent 通过 emit_event 工具发出的事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   eventBus agent:event → Gateway event 'agent.event'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';

export const initAgentEventBridge: EventBridgeInit = (gateway) => {
  const handler = (payload: Record<string, unknown>): void => {
    gateway.broadcastEvent('agent.event', payload);
  };

  eventBus.on('agent:event', handler);
  log.info('[AgentEventBridge] Agent 事件桥接初始化完成');

  return () => {
    eventBus.off('agent:event', handler);
    log.info('[AgentEventBridge] Agent 事件桥接已清理');
  };
};
