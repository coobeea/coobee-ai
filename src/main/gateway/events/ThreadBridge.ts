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
  const handleCreated = (event: ThreadCreatedEvent): void => {
    gateway.broadcastEvent('thread.created', event);
  };

  const handleUpdated = (event: ThreadUpdatedEvent): void => {
    gateway.broadcastEvent('thread.updated', event);
  };

  const handleDeleted = (event: ThreadDeletedEvent): void => {
    gateway.broadcastEvent('thread.deleted', event);
  };

  const handleStatus = (event: ThreadStatusEvent): void => {
    gateway.broadcastEvent('thread.status', event);
  };

  eventBus.on(ThreadEventType.CREATED, handleCreated);
  eventBus.on(ThreadEventType.UPDATED, handleUpdated);
  eventBus.on(ThreadEventType.DELETED, handleDeleted);
  eventBus.on(ThreadEventType.STATUS, handleStatus);

  log.info('[ThreadBridge] Thread 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off(ThreadEventType.CREATED, handleCreated);
    eventBus.off(ThreadEventType.UPDATED, handleUpdated);
    eventBus.off(ThreadEventType.DELETED, handleDeleted);
    eventBus.off(ThreadEventType.STATUS, handleStatus);
    log.info('[ThreadBridge] Thread 事件桥接已清理');
  };
};
