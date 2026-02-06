/**
 * Event Registration Hook
 *
 * 自动扫描并注册所有事件处理器
 * - 扫描 @main/events 目录下所有 *Changed.ts 文件
 * - 将文件名转换为事件名（例如：themeChanged -> config:theme:changed）
 * - 注册事件监听器到 EventBus
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * 将驼峰命名转换为事件名
 * 例如: themeChanged -> theme:changed
 * 例如: autoStartChanged -> autoStart:changed
 */
function camelToEventName(camelCase: string): string {
  // 移除末尾的 Changed 后缀
  const withoutChanged = camelCase.replace(/Changed$/, '')

  // 直接添加 :changed 后缀，保持原有的驼峰命名
  return withoutChanged + ':changed'
}

/**
 * Event Registration Hook
 *
 * 在 READY 阶段注册所有事件处理器
 * 优先级设置为 1000（在其他服务初始化之后）
 *
 * 注意：事件处理器可能依赖多个模块（config、trayManager、windowManager等）
 * 因此需要在这些服务初始化之后再执行
 */
export const ReadyEventRegistrationHook: LifecycleHook = {
  name: 'ready-event-registration',
  phase: LifecyclePhase.READY,
  priority: 1000,
  critical: true,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyEventRegistrationHook] 开始注册事件处理器...')

    try {
      // 动态导入避免循环依赖
      const { eventBus } = await import('@main/common/eventbus')
      const { scanEventHandlers } = await import('@main/common/scan')

      // 扫描所有事件处理器文件
      const discoveredModules = scanEventHandlers()
      log.info(`[ReadyEventRegistrationHook] 扫描到 ${discoveredModules.length} 个事件处理器文件`)

      const registeredEvents: string[] = []
      let totalRegisteredCount = 0

      for (const discovered of discoveredModules) {
        const moduleContent = discovered.module

        // 从路径中提取模块名 (例如: @main/events/themeChanged.ts -> themeChanged)
        const moduleName =
          discovered.path
            .split('/')
            .pop()
            ?.replace(/\.(ts|js)$/, '') || ''

        try {
          let registeredCount = 0

          // 方式1: 支持默认导出 - 文件名以Changed结尾
          if (
            moduleName.endsWith('Changed') &&
            moduleContent.default &&
            typeof moduleContent.default === 'function'
          ) {
            // 将文件名转换为事件名
            const eventName = camelToEventName(moduleName)

            // 注册事件监听器
            eventBus.on(eventName, moduleContent.default as (...args: unknown[]) => void)

            registeredEvents.push(`  '${eventName}' -> ${moduleName}(默认导出)`)
            registeredCount++
          }
          // 方式2: 支持命名导出 - 方法名以Changed结尾
          else {
            // 遍历所有导出的方法
            for (const [methodName, method] of Object.entries(moduleContent)) {
              if (typeof method === 'function' && methodName.endsWith('Changed')) {
                // 将方法名转换为事件名
                const eventName = camelToEventName(methodName)

                // 注册事件监听器
                eventBus.on(eventName, method as (...args: unknown[]) => void)

                registeredEvents.push(`  '${eventName}' -> ${moduleName}.${methodName}`)
                registeredCount++
              }
            }
          }

          if (registeredCount > 0) {
            totalRegisteredCount += registeredCount
          }
        } catch (error) {
          log.error(`[ReadyEventRegistrationHook] 注册事件处理器 ${moduleName} 失败:`, error)
        }
      }

      // 输出所有注册的事件处理器列表
      if (registeredEvents.length > 0) {
        log.info('[ReadyEventRegistrationHook] 📊 已注册的事件处理器: [')
        registeredEvents.forEach((event) => log.info(event))
        log.info(']')
        log.info(
          `[ReadyEventRegistrationHook] 🎉 事件处理器注册完成，共注册了 ${totalRegisteredCount} 个事件处理器`
        )
      } else {
        log.warn('[ReadyEventRegistrationHook] ⚠️ 没有注册任何事件处理器')
      }
    } catch (error) {
      log.error('[ReadyEventRegistrationHook] 事件处理器注册失败:', error)
      throw error
    }
  }
}
