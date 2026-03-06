/**
 * Gateway 事件桥接 — Discussion Event
 *
 * 将讨论室消息事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   eventBus discussion:message → Gateway event 'discussion.message'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';

export const initDiscussionBridge: EventBridgeInit = (gateway) => {
  const handler = (payload: { roomId: string; participant: string; content: string; timestamp: number }): void => {
    log.debug('[DiscussionBridge] Broadcasting message:', payload.roomId, payload.participant);
    gateway.broadcastEvent('discussion.message', payload);
  };

  eventBus.on('discussion:message', handler);
  log.info('[DiscussionBridge] Discussion 事件桥接初始化完成');

  return () => {
    eventBus.off('discussion:message', handler);
    log.info('[DiscussionBridge] Discussion 事件桥接已清理');
  };
};
