/**
 * Gateway 事件桥接 — Stream
 *
 * 将内部 EventBus 的 Stream 事件转换为 Gateway 事件推送。
 *
 * 桥接映射：
 *   EventBus stream:message → Gateway event 'stream.message'（按 sessionId 过滤）
 *   EventBus stream:start   → Gateway event 'stream.start'
 *   EventBus stream:end     → Gateway event 'stream.end'
 *   EventBus stream:error   → Gateway event 'stream.error'
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import { StreamEventType, type StreamEvent } from '@main/ai/streaming/types';
import type { EventBridgeInit } from '../protocol';

export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handleMessage = (event: StreamEvent): void => {
    if (!event.message) return;

    const sessionId = event.sessionId;
    gateway.broadcastEventIf('stream.message', { sessionId, message: event.message }, (meta) =>
      meta.subscribedSessions.has(sessionId)
    );
  };

  const handleStart = (event: StreamEvent): void => {
    gateway.broadcastEventIf('stream.start', { sessionId: event.sessionId }, (meta) =>
      meta.subscribedSessions.has(event.sessionId)
    );
  };

  const handleEnd = (event: StreamEvent): void => {
    gateway.broadcastEventIf('stream.end', { sessionId: event.sessionId }, (meta) =>
      meta.subscribedSessions.has(event.sessionId)
    );
  };

  const handleError = (event: StreamEvent): void => {
    gateway.broadcastEventIf('stream.error', { sessionId: event.sessionId, error: event.error }, (meta) =>
      meta.subscribedSessions.has(event.sessionId)
    );
  };

  eventBus.on(StreamEventType.MESSAGE, handleMessage);
  eventBus.on(StreamEventType.START, handleStart);
  eventBus.on(StreamEventType.END, handleEnd);
  eventBus.on(StreamEventType.ERROR, handleError);

  log.info('[StreamBridge] Stream 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off(StreamEventType.MESSAGE, handleMessage);
    eventBus.off(StreamEventType.START, handleStart);
    eventBus.off(StreamEventType.END, handleEnd);
    eventBus.off(StreamEventType.ERROR, handleError);
    log.info('[StreamBridge] Stream 事件桥接已清理');
  };
};
