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
import type { DiscussionMessage } from '@main/ai/discussion/types';

export const initDiscussionBridge: EventBridgeInit = (gateway) => {
  // 消息事件处理器（适配新的 payload 格式）
  const messageHandler = (payload: { threadId: string; message: DiscussionMessage }): void => {
    log.debug('[DiscussionBridge] Broadcasting message:', payload.threadId, payload.message.agentId);
    // 转换为前端期望的格式
    gateway.broadcastEvent('discussion.message', {
      threadId: payload.threadId,
      message: payload.message
    });
  };

  // 讨论结束事件处理器（适配新的 payload 格式）
  const endedHandler = (payload: {
    threadId: string;
    reason: string;
    consensusLevel?: number;
    totalRounds: number;
    messageCount: number;
    conclusion?: string;
  }): void => {
    log.info('[DiscussionBridge] Broadcasting discussion ended:', payload.threadId, payload.reason);
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
