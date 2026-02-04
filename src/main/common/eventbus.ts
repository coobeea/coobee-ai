import EventEmitter from 'events'

import { log } from './logger'
import { scanEventHandlers } from './scan'
import type { EventHandler } from './types'

/**
 * 事件总线
 * 基于 EventEmitter 的事件发布订阅系统
 *
 * 功能：
 * - 自动扫描并注册事件处理器
 * - 支持类型安全的事件发布和订阅
 * - 提供事件日志记录和调试
 *
 * 使用规范：
 * - 事件处理器文件必须以 Handler.ts 结尾
 * - 必须实现 EventHandler 接口
 * - 必须作为默认导出或命名导出
 */
class EventBus extends EventEmitter {
  private registeredHandlers: Map<string, EventHandler[]> = new Map()

  constructor() {
    super()
    this.setMaxListeners(1000) // 提高监听器数量限制
    this.initializeHandlers()
  }

  /**
   * 初始化事件处理器
   * 在构造函数中自动调用，无需手动初始化
   */
  private initializeHandlers(): void {
    log.info('[EventBus] 开始初始化事件处理器...')

    try {
      // 使用 scan.ts 扫描事件处理器
      const discoveredModules = scanEventHandlers()

      let totalRegistered = 0
      const registeredList: string[] = []

      for (const { path, module } of discoveredModules) {
        try {
          // 尝试获取默认导出或命名导出的处理器
          const handlers = this.extractHandlers(module, path)

          for (const handler of handlers) {
            this.registerHandler(handler)
            registeredList.push(`  '${handler.event}' -> ${handler.name}`)
            totalRegistered++
          }
        } catch (error) {
          log.error(`[EventBus] 注册事件处理器失败 [${path}]:`, error)
        }
      }

      if (totalRegistered > 0) {
        log.info('[EventBus] 已注册的事件处理器:')
        registeredList.forEach((item) => log.info(item))
        log.info(`[EventBus] 事件处理器初始化完成，共注册 ${totalRegistered} 个处理器`)
      } else {
        log.warn('[EventBus] 未发现任何事件处理器')
      }
    } catch (error) {
      log.error('[EventBus] 初始化事件处理器失败:', error)
    }
  }

  /**
   * 从模块中提取事件处理器
   */
  private extractHandlers(module: Record<string, unknown>, path: string): EventHandler[] {
    const handlers: EventHandler[] = []

    // 1. 尝试默认导出
    if (module.default && this.isEventHandler(module.default)) {
      handlers.push(module.default as EventHandler)
    }

    // 2. 尝试命名导出
    for (const [key, value] of Object.entries(module)) {
      if (key !== 'default' && this.isEventHandler(value)) {
        handlers.push(value as EventHandler)
      }
    }

    if (handlers.length === 0) {
      log.warn(`[EventBus] 模块未导出有效的 EventHandler [${path}]`)
    }

    return handlers
  }

  /**
   * 检查对象是否是有效的 EventHandler
   */
  private isEventHandler(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') {
      return false
    }

    const handler = obj as Partial<EventHandler>
    return (
      typeof handler.name === 'string' &&
      typeof handler.event === 'string' &&
      typeof handler.handle === 'function'
    )
  }

  /**
   * 注册事件处理器
   */
  private registerHandler(handler: EventHandler): void {
    // 记录到注册表
    if (!this.registeredHandlers.has(handler.event)) {
      this.registeredHandlers.set(handler.event, [])
    }
    this.registeredHandlers.get(handler.event)!.push(handler)

    // 注册到 EventEmitter
    this.on(handler.event, handler.handle)

    log.debug(
      `[EventBus] 注册处理器: ${handler.name} -> 事件: ${handler.event}${handler.description ? ` (${handler.description})` : ''}`
    )
  }

  /**
   * 发送事件
   * 覆盖父类方法以添加日志记录
   */
  emit(eventName: string, ...args: unknown[]): boolean {
    const handlers = this.registeredHandlers.get(eventName)
    const handlerCount = handlers ? handlers.length : 0

    log.debug(`[EventBus] 发送事件: ${eventName} (${handlerCount} 个处理器)`, args)

    return super.emit(eventName, ...args)
  }

  /**
   * 获取已注册的事件处理器列表
   */
  getRegisteredHandlers(eventName?: string): EventHandler[] {
    if (eventName) {
      return this.registeredHandlers.get(eventName) || []
    }

    // 返回所有处理器
    const allHandlers: EventHandler[] = []
    for (const handlers of this.registeredHandlers.values()) {
      allHandlers.push(...handlers)
    }
    return allHandlers
  }
}

export const eventBus = new EventBus()
