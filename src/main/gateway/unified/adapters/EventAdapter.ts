/**
 * Event Adapter - 事件适配器
 *
 * 将传统的 EventBus 事件适配到统一协议
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import type { UnifiedEvent } from '../types';
import { getUnifiedGateway } from '../UnifiedGateway';

/**
 * EventBus 到 UnifiedGateway 的桥接
 */
export class EventAdapter {
  private unsubscribers: Array<() => void> = [];
  private handlers = new Map<string, (data: unknown) => void>();

  /**
   * 桥接 EventBus 事件到 UnifiedGateway
   */
  bridgeEventBusToUnified(eventName: string): void {
    const unifiedGateway = getUnifiedGateway();

    // 创建处理函数
    const handler = (data: unknown): void => {
      // 转发到 UnifiedGateway
      const event: UnifiedEvent = {
        event: eventName,
        data,
        timestamp: Date.now()
      };

      unifiedGateway.emit(eventName, event).catch((error) => {
        log.error(`[EventAdapter] 转发事件失败: ${eventName}`, error);
      });
    };

    // 监听 EventBus 事件
    eventBus.on(eventName, handler);
    this.handlers.set(eventName, handler);

    // 保存取消订阅函数
    const unsubscribe = (): void => {
      const h = this.handlers.get(eventName);
      if (h) {
        eventBus.off(eventName, h);
        this.handlers.delete(eventName);
      }
    };

    this.unsubscribers.push(unsubscribe);

    log.debug(`[EventAdapter] 桥接事件: ${eventName}`);
  }

  /**
   * 批量桥接事件
   */
  bridgeMultipleEvents(eventNames: string[]): void {
    for (const eventName of eventNames) {
      this.bridgeEventBusToUnified(eventName);
    }

    log.info(`[EventAdapter] 已桥接 ${eventNames.length} 个事件`);
  }

  /**
   * 清理所有桥接
   */
  cleanup(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    log.info('[EventAdapter] 已清理所有事件桥接');
  }
}
