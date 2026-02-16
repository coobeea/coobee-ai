import EventEmitter from 'events'

import { log } from './logger'

/**
 * 事件总线
 * 基于 EventEmitter 的事件发布订阅系统
 *
 * 功能：
 * - 支持类型安全的事件发布和订阅
 * - 提供事件日志记录和调试
 *
 * 事件注册：
 * - 事件处理器通过 EventRegistrationHook 自动注册
 * - 事件文件位于 @main/events 目录，以 *Changed.ts 结尾
 * - 使用默认导出函数，文件名自动转换为事件名
 */
class EventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(1000) // 提高监听器数量限制
    log.debug('[EventBus] EventBus 实例已创建')
  }

  /** 高频事件前缀，仅记录事件名不打印 payload，避免刷屏 */
  private static readonly QUIET_PREFIXES = ['stream:', 'window:']

  /**
   * 发送事件
   * 覆盖父类方法以添加日志记录（高频事件静默处理）
   */
  emit(eventName: string, ...args: unknown[]): boolean {
    const quiet = EventBus.QUIET_PREFIXES.some((p) => eventName.startsWith(p))
    if (!quiet) {
      const listenerCount = this.listenerCount(eventName)
      log.debug(`[EventBus] 发送事件: ${eventName} (${listenerCount} 个监听器)`, args)
    }
    // 逐个调用 listener 并捕获异常，防止单个 listener 抛错阻断其他 listener
    const listeners = this.rawListeners(eventName)
    if (listeners.length === 0) return false
    for (const listener of listeners) {
      try {
        ;(listener as (...a: unknown[]) => void)(...args)
      } catch (err) {
        log.error(`[EventBus] Listener error on "${eventName}":`, err)
      }
    }
    return true
  }
}

export const eventBus = new EventBus()
