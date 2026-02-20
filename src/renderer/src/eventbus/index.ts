/**
 * EventBus 模块统一导出
 *
 * 前端 EventBus - 基于 mitt 实现
 * 统一管理前端事件分发，支持来自主进程的 IPC 事件和前端内部事件
 */

import mitt, { type Emitter } from 'mitt';
import type { EventPayloads, EventType, GenericEventHandler } from '@shared/ipc/events';

class FrontendEventBus {
  private emitter: Emitter<Record<EventType, unknown>>;

  constructor() {
    this.emitter = mitt();
  }

  /**
   * 订阅事件
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  on<T extends keyof EventPayloads>(eventType: T, callback: (data: EventPayloads[T]) => void): void {
    this.emitter.on(eventType as EventType, callback as GenericEventHandler);
  }

  /**
   * 分发事件
   * @param eventType 事件类型
   * @param data 事件数据
   */
  emit<T extends keyof EventPayloads>(eventType: T, data: EventPayloads[T]): void {
    this.emitter.emit(eventType as EventType, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private onceMap = new WeakMap<Function, GenericEventHandler>();

  /**
   * 单次订阅（触发一次后自动取消）
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  once<T extends keyof EventPayloads>(eventType: T, callback: (data: EventPayloads[T]) => void): void {
    const wrappedCallback = (data: EventPayloads[T]): void => {
      this.off(eventType, wrappedCallback);
      this.onceMap.delete(callback);
      callback(data);
    };
    this.onceMap.set(callback, wrappedCallback as GenericEventHandler);
    this.on(eventType, wrappedCallback);
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  off<T extends keyof EventPayloads>(eventType: T, callback: (data: EventPayloads[T]) => void): void {
    // 检查是否是被 once 包裹的回调
    const wrappedCallback = this.onceMap.get(callback);
    if (wrappedCallback) {
      this.emitter.off(eventType as EventType, wrappedCallback);
      this.onceMap.delete(callback);
    } else {
      this.emitter.off(eventType as EventType, callback as GenericEventHandler);
    }
  }

  /**
   * 清除所有事件监听
   */
  clear(): void {
    this.emitter.all.clear();
  }

  /**
   * 获取所有已注册的事件类型
   */
  getRegisteredEvents(): EventType[] {
    return Array.from(this.emitter.all.keys()) as EventType[];
  }
}

// 创建单例
export const eventBus = new FrontendEventBus();

// 默认导出
export default eventBus;

// 同时导出 useEventBus
export { useEventBus } from '@/composables/useEventBus';
