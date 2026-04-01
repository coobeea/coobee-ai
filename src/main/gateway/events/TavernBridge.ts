/**
 * TavernBridge - 酒馆任务事件桥接
 *
 * 将后端的 tavern 事件桥接到前端 WebSocket
 */

import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import type { EventBridgeInit } from '../protocol';

const log = createLogger('tavern-bridge');

/**
 * 初始化酒馆事件桥接
 */
export const initTavernBridge: EventBridgeInit = (gateway) => {
  log.info('[TavernBridge] Initializing tavern event bridge');

  // 阶段变化事件处理器
  const stageChangedHandler = (data: unknown): void => {
    log.debug('[TavernBridge] Broadcasting tavern:stage-changed:', data);
    gateway.broadcastEvent('tavern.stage-changed', data);
  };

  // 进度事件处理器
  const progressHandler = (data: unknown): void => {
    log.debug('[TavernBridge] Broadcasting tavern:progress:', data);
    gateway.broadcastEvent('tavern.progress', data);
  };

  // 注册事件监听
  eventBus.on('tavern:stage-changed', stageChangedHandler);
  eventBus.on('tavern:progress', progressHandler);

  log.info('[TavernBridge] Tavern event bridge initialized');

  // 返回清理函数
  return () => {
    eventBus.off('tavern:stage-changed', stageChangedHandler);
    eventBus.off('tavern:progress', progressHandler);
    log.info('[TavernBridge] Tavern event bridge cleaned up');
  };
};
