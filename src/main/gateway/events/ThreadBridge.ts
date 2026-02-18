/**
 * Gateway 事件桥接 — Thread
 *
 * 将内部 EventBus 的 Thread 生命周期事件转换为 Gateway 事件推送。
 *
 * 桥接映射：
 *   EventBus thread:created → Gateway event 'thread.created'  （广播给所有客户端）
 *   EventBus thread:updated → Gateway event 'thread.updated'  （广播给所有客户端）
 *   EventBus thread:deleted → Gateway event 'thread.deleted'  （广播给所有客户端）
 *   EventBus thread:status  → Gateway event 'thread.status'   （广播给所有客户端）
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import {
  ThreadEventType,
  type ThreadCreatedEvent,
  type ThreadUpdatedEvent,
  type ThreadDeletedEvent,
  type ThreadStatusEvent
} from '@main/ai/threads/ThreadStore';
import type { EventBridgeInit } from '../protocol';

export const initThreadBridge: EventBridgeInit = (gateway) => {
  eventBus.on(ThreadEventType.CREATED, (event: ThreadCreatedEvent) => {
    gateway.broadcastEvent('thread.created', event);
  });

  eventBus.on(ThreadEventType.UPDATED, (event: ThreadUpdatedEvent) => {
    gateway.broadcastEvent('thread.updated', event);
  });

  eventBus.on(ThreadEventType.DELETED, (event: ThreadDeletedEvent) => {
    gateway.broadcastEvent('thread.deleted', event);
  });

  eventBus.on(ThreadEventType.STATUS, (event: ThreadStatusEvent) => {
    gateway.broadcastEvent('thread.status', event);
  });

  log.info('[ThreadBridge] Thread 事件桥接初始化完成');
};
