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

  /**
   * 发送事件
   * 覆盖父类方法以添加日志记录
   */
  emit(eventName: string, ...args: unknown[]): boolean {
    const listenerCount = this.listenerCount(eventName)
    log.debug(`[EventBus] 发送事件: ${eventName} (${listenerCount} 个监听器)`, args)
    return super.emit(eventName, ...args)
  }
}

export const eventBus = new EventBus()
