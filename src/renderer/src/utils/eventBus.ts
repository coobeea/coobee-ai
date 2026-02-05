/**
 * 前端 EventBus - 基于 mitt 实现
 * 统一管理前端事件分发，支持来自主进程的 IPC 事件和前端内部事件
 */

import mitt, { type Emitter } from 'mitt'
import type { EventPayloads, EventType, GenericEventHandler } from '@shared/ipc/events'

class FrontendEventBus {
  private emitter: Emitter<Record<EventType, unknown>>

  constructor() {
    this.emitter = mitt()
  }

  /**
   * 订阅事件
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  on<T extends keyof EventPayloads>(
    eventType: T,
    callback: (data: EventPayloads[T]) => void
  ): void {
    console.log(`[EventBus] 订阅事件: ${eventType}`)
    this.emitter.on(eventType as EventType, callback as GenericEventHandler)
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  off<T extends keyof EventPayloads>(
    eventType: T,
    callback: (data: EventPayloads[T]) => void
  ): void {
    console.log(`[EventBus] 取消订阅: ${eventType}`)
    this.emitter.off(eventType as EventType, callback as GenericEventHandler)
  }

  /**
   * 发送事件
   * @param eventType 事件类型
   * @param data 事件数据
   */
  emit<T extends keyof EventPayloads>(eventType: T, data: EventPayloads[T]): void {
    console.log(`[EventBus] 发送事件: ${eventType}`, data)
    this.emitter.emit(eventType as EventType, data)
  }

  /**
   * 单次订阅（触发一次后自动取消）
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  once<T extends keyof EventPayloads>(
    eventType: T,
    callback: (data: EventPayloads[T]) => void
  ): void {
    const wrappedCallback = (data: EventPayloads[T]): void => {
      callback(data)
      this.off(eventType, wrappedCallback)
    }
    this.on(eventType, wrappedCallback)
  }

  /**
   * 清除所有事件监听
   */
  clear(): void {
    console.log('[EventBus] 清除所有事件监听')
    this.emitter.all.clear()
  }

  /**
   * 获取所有已注册的事件类型
   */
  getRegisteredEvents(): EventType[] {
    return Array.from(this.emitter.all.keys()) as EventType[]
  }
}

// 创建单例
export const eventBus = new FrontendEventBus()

// 默认导出
export default eventBus
