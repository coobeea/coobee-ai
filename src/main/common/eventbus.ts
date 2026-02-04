import EventEmitter from 'events'

import { log } from './logger'

function camelToEventName(camelCase: string): string {
  const withoutChanged = camelCase.replace(/Changed$/, '')
  return withoutChanged + ':changed'
}

class EventBus extends EventEmitter {
  constructor() {
    super()
  }

  initConsumers(): void {
    log.info('🎯 开始初始化事件消费者...')

    try {
        const modules = import.meta.glob('../events/**/*.ts', { eager: true })

      const moduleCount = Object.keys(modules).length
      log.info(`📁 通过glob发现 ${moduleCount} 个潜在的事件处理器文件`)

      const registeredEvents: string[] = []
      let totalRegisteredCount = 0

      for (const moduleRelativePath in modules) {
        const moduleContent = modules[moduleRelativePath] as Record<string, any>

        if (moduleContent) {
          const moduleName =
            moduleRelativePath
              .split('/')
              .pop()
              ?.replace(/\.(ts|js)$/, '') || ''

          try {
            let registeredCount = 0

            if (
              moduleName.endsWith('Changed') &&
              moduleContent.default &&
              typeof moduleContent.default === 'function'
            ) {
              const eventName = camelToEventName(moduleName)
              this.on(eventName, moduleContent.default as (...args: any[]) => void)
              registeredEvents.push(`  '${eventName}' -> ${moduleName}(默认导出)`)
              registeredCount++
            } else {
              for (const [methodName, method] of Object.entries(moduleContent)) {
                if (typeof method === 'function' && methodName.endsWith('Changed')) {
                  const eventName = camelToEventName(methodName)
                  this.on(eventName, method as (...args: any[]) => void)
                  registeredEvents.push(`  '${eventName}' -> ${moduleName}.${methodName}`)
                  registeredCount++
                }
              }
            }

            if (registeredCount > 0) {
              totalRegisteredCount += registeredCount
            }
          } catch (error) {
            log.error(`❌ 注册事件消费者 ${moduleName} 失败:`, error)
          }
        } else {
          log.warn(`⚠️ 无法加载模块内容: ${moduleRelativePath}`)
        }
      }

      if (registeredEvents.length > 0) {
        log.info('📊 已注册的事件处理器: [')
        registeredEvents.forEach((event) => log.info(event))
        log.info(']')
        log.info(`🎉 事件消费者初始化完成，共注册了 ${totalRegisteredCount} 个事件处理器`)
      } else {
        log.warn('⚠️ 没有注册任何事件处理器')
      }
    } catch (error) {
      log.error('❌ 初始化事件消费者失败:', error)
    }
  }

  emit(eventName: string, ...args: any[]): boolean {
    log.debug(`🔔 触发事件: ${eventName}`, args)
    return super.emit(eventName, ...args)
  }
}

export const eventBus = new EventBus()
