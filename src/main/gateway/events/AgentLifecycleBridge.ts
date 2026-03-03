/**
 * Gateway 事件桥接 — Agent Lifecycle
 *
 * 将 Agent 生命周期事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   eventBus agent:start → Gateway event 'agent.start'
 *   eventBus agent:done  → Gateway event 'agent.done'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';

export const initAgentLifecycleBridge: EventBridgeInit = (gateway) => {
  const handleStart = (payload: Record<string, unknown>): void => {
    gateway.broadcastEvent('agent.start', payload);
  };

  const handleDone = (payload: Record<string, unknown>): void => {
    gateway.broadcastEvent('agent.done', payload);
  };

  eventBus.on('agent:start', handleStart);
  eventBus.on('agent:done', handleDone);
  log.info('[AgentLifecycleBridge] Agent 生命周期事件桥接初始化完成');

  return () => {
    eventBus.off('agent:start', handleStart);
    eventBus.off('agent:done', handleDone);
    log.info('[AgentLifecycleBridge] Agent 生命周期事件桥接已清理');
  };
};
