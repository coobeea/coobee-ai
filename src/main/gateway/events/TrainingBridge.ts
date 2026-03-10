/**
 * Gateway 事件桥接 — Training Event
 *
 * 将训练进度和状态事件推送到前端 WebSocket 客户端。
 *
 * 桥接映射：
 *   eventBus training:progress → Gateway event 'training.progress'
 *   eventBus training:completed → Gateway event 'training.completed'
 *   eventBus training:failed → Gateway event 'training.failed'
 *   eventBus training:round-completed → Gateway event 'training.roundCompleted'
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { EventBridgeInit } from '../protocol';

export const initTrainingBridge: EventBridgeInit = (gateway) => {
  // 训练进度更新
  const progressHandler = (data: unknown): void => {
    log.debug('[TrainingBridge] 进度更新:', data);
    gateway.broadcastEvent('training.progress', data);
  };

  // 训练完成
  const completedHandler = (data: unknown): void => {
    log.info('[TrainingBridge] 训练完成:', data);
    gateway.broadcastEvent('training.completed', data);
  };

  // 训练失败
  const failedHandler = (data: unknown): void => {
    log.error('[TrainingBridge] 训练失败:', data);
    gateway.broadcastEvent('training.failed', data);
  };

  // 单轮完成
  const roundCompletedHandler = (data: unknown): void => {
    log.debug('[TrainingBridge] 单轮完成:', data);
    gateway.broadcastEvent('training.roundCompleted', data);
  };

  eventBus.on('training:progress', progressHandler);
  eventBus.on('training:completed', completedHandler);
  eventBus.on('training:failed', failedHandler);
  eventBus.on('training:round-completed', roundCompletedHandler);

  log.info('[TrainingBridge] Training 事件桥接初始化完成');

  return () => {
    eventBus.off('training:progress', progressHandler);
    eventBus.off('training:completed', completedHandler);
    eventBus.off('training:failed', failedHandler);
    eventBus.off('training:round-completed', roundCompletedHandler);
    log.info('[TrainingBridge] Training 事件桥接已清理');
  };
};
