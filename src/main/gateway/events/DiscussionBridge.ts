/**
 * Gateway 事件桥接 — Discussion Event
 *
 * 将讨论室消息和状态事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   eventBus discussion:message → Gateway event 'discussion.message'
 *   eventBus discussion:ended → Gateway event 'discussion.ended'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';

export const initDiscussionBridge: EventBridgeInit = (gateway) => {
  // 消息事件处理器
  const messageHandler = (payload: {
    roomId: string;
    participant: string;
    content: string;
    timestamp: number;
  }): void => {
    log.debug('[DiscussionBridge] Broadcasting message:', payload.roomId, payload.participant);
    gateway.broadcastEvent('discussion.message', payload);
  };

  // 讨论结束事件处理器
  const endedHandler = (payload: {
    roomId: string;
    reason: string;
    consensusLevel: number;
    messageCount: number;
  }): void => {
    log.info('[DiscussionBridge] Broadcasting discussion ended:', payload.roomId, payload.reason);
    gateway.broadcastEvent('discussion.ended', payload);
  };

  eventBus.on('discussion:message', messageHandler);
  eventBus.on('discussion:ended', endedHandler);
  log.info('[DiscussionBridge] Discussion 事件桥接初始化完成');

  return () => {
    eventBus.off('discussion:message', messageHandler);
    eventBus.off('discussion:ended', endedHandler);
    log.info('[DiscussionBridge] Discussion 事件桥接已清理');
  };
};
