/**
 * Gateway 事件桥接 — GroupChat Event
 *
 * 桥接映射：
 *   eventBus groupchat:message → Gateway event 'groupchat.message'
 *   eventBus groupchat:typing  → Gateway event 'groupchat.typing'
 *   eventBus groupchat:ended   → Gateway event 'groupchat.ended'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';
import type { DiscussionMessage } from '@main/ai/discussion/types';

export const initGroupChatBridge: EventBridgeInit = (gateway) => {
  const messageHandler = (payload: { sessionId: string; message: DiscussionMessage }): void => {
    gateway.broadcastEvent('groupchat.message', payload);
  };

  const typingHandler = (payload: { sessionId: string; agentId: string; typing: boolean }): void => {
    gateway.broadcastEvent('groupchat.typing', payload);
  };

  const endedHandler = (payload: { sessionId: string }): void => {
    gateway.broadcastEvent('groupchat.ended', payload);
  };

  eventBus.on('groupchat:message', messageHandler);
  eventBus.on('groupchat:typing', typingHandler);
  eventBus.on('groupchat:ended', endedHandler);
  log.info('[GroupChatBridge] 事件桥接初始化完成');

  return () => {
    eventBus.off('groupchat:message', messageHandler);
    eventBus.off('groupchat:typing', typingHandler);
    eventBus.off('groupchat:ended', endedHandler);
  };
};
