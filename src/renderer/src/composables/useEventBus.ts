/**
 * EventBus Composable
 * 提供类型安全的事件订阅和发送功能
 * 自动管理事件生命周期（组件卸载时自动清理）
 */

import { onUnmounted } from 'vue'
import eventBus from '@/utils/eventBus'
import type { EventPayloads } from '@shared/ipc/events'

/**
 * 事件订阅记录
 */
interface EventSubscription {
  eventType: keyof EventPayloads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: any
}

/**
 * 使用 EventBus 的 Composable
 * @returns EventBus 操作方法
 */
export function useEventBus(): {
  on: <T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ) => void
  off: <T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ) => void
  once: <T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ) => void
  emit: <T extends keyof EventPayloads>(eventType: T, data: EventPayloads[T]) => void
} {
  // 记录当前组件订阅的事件，用于自动清理
  const subscriptions: EventSubscription[] = []

  /**
   * 订阅事件
   * 组件卸载时会自动取消订阅
   * @param eventType 事件类型
   * @param handler 事件处理器
   */
  function on<T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ): void {
    eventBus.on(eventType, handler)
    subscriptions.push({ eventType, handler })
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param handler 事件处理器
   */
  function off<T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ): void {
    eventBus.off(eventType, handler)
    const index = subscriptions.findIndex(
      (sub) => sub.eventType === eventType && sub.handler === handler
    )
    if (index !== -1) {
      subscriptions.splice(index, 1)
    }
  }

  /**
   * 单次订阅（触发一次后自动取消）
   * @param eventType 事件类型
   * @param handler 事件处理器
   */
  function once<T extends keyof EventPayloads>(
    eventType: T,
    handler: (data: EventPayloads[T]) => void
  ): void {
    eventBus.once(eventType, handler)
  }

  /**
   * 发送事件
   * @param eventType 事件类型
   * @param data 事件数据
   */
  function emit<T extends keyof EventPayloads>(eventType: T, data: EventPayloads[T]): void {
    eventBus.emit(eventType, data)
  }

  /**
   * 组件卸载时自动取消所有订阅
   */
  onUnmounted(() => {
    subscriptions.forEach((sub) => {
      eventBus.off(sub.eventType, sub.handler)
    })
    subscriptions.length = 0
  })

  return {
    on,
    off,
    once,
    emit
  }
}
