import { log } from './logger'
import { DiscoveredModule } from './types'

/**
 * 扫描所有处理器文件
 */
export function scanProcessors(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描处理器文件...')

  const modules = import.meta.glob('@main/jobs/**/*Processor.ts', { eager: true })
  const totalFound = Object.keys(modules).length

  log.info(`[Scan] 发现 ${totalFound} 个潜在的处理器文件:`)
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`)
  })

  const filteredModules = filterModules(modules, ['ProcessorRegistry', 'BaseProcessor'])
  const filteredCount = filteredModules.length

  log.info(`[Scan] 过滤后剩余 ${filteredCount} 个处理器文件:`)
  filteredModules.forEach((discoveredModule, index) => {
    log.info(`[Scan]   ${index + 1}. ${discoveredModule.path}`)
  })

  log.info('[Scan] 处理器文件扫描完成')

  return filteredModules
}

/**
 * 扫描作业文件
 */
export function scanJobs(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描作业文件...')

  const modules = import.meta.glob('@main/jobs/**/*Job.ts', { eager: true })
  const totalFound = Object.keys(modules).length

  log.info(`[Scan] 发现 ${totalFound} 个潜在的作业文件:`)
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`)
  })

  const filteredModules = filterModules(modules, ['JobRegistry', 'BaseJob'])
  const filteredCount = filteredModules.length

  log.info(`[Scan] 过滤后剩余 ${filteredCount} 个作业文件:`)
  filteredModules.forEach((discoveredModule, index) => {
    log.info(`[Scan]   ${index + 1}. ${discoveredModule.path}`)
  })

  log.info('[Scan] 作业文件扫描完成')

  return filteredModules
}

/**
 * 扫描 API 文件
 */
export function scanApis(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描API文件...')

  const modules = import.meta.glob('@main/api/**/*.ts', { eager: true })
  const totalFound = Object.keys(modules).length

  log.info(`[Scan] 发现 ${totalFound} 个API文件:`)
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`)
  })

  const filteredModules = filterModules(modules)
  const filteredCount = filteredModules.length

  log.info(`[Scan] API文件扫描完成，共 ${filteredCount} 个文件`)

  return filteredModules
}

/**
 * 扫描生命周期 Bean 文件
 * 只返回实现了 LifeCycle 接口的类
 */
export function scanLifeCycleBeans(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描生命周期Bean文件...')

  // 扫描 service 目录下的所有 TypeScript 文件
  const modules = import.meta.glob('@main/config/**/*.ts', { eager: true })
  const totalFound = Object.keys(modules).length

  log.info(`[Scan] 发现 ${totalFound} 个文件:`)
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`)
  })

  // 过滤出实现了 LifeCycle 接口的模块
  const lifeCycleModules = filterLifeCycleModules(modules)
  const filteredCount = lifeCycleModules.length

  log.info(`[Scan] 过滤后找到 ${filteredCount} 个生命周期Bean:`)
  lifeCycleModules.forEach((discoveredModule, index) => {
    log.info(`[Scan]   ${index + 1}. ${discoveredModule.path} (${discoveredModule.exportName})`)
  })

  log.info('[Scan] 生命周期Bean扫描完成')

  return lifeCycleModules
}

/**
 * 通用过滤函数 - 过滤掉指定的文件
 * @param modules 扫描结果对象 (使用 eager: true 时，值直接是模块内容)
 * @param excludePatterns 要排除的文件名模式数组
 * @returns 过滤后的模块对象
 */
export function filterModules(
  modules: Record<string, unknown>,
  excludePatterns: string[] = []
): DiscoveredModule[] {
  const filteredModules: DiscoveredModule[] = []

  for (const [modulePath, moduleContent] of Object.entries(modules)) {
    // 检查是否应该排除这个文件
    const shouldExclude = excludePatterns.some((excludePattern) =>
      modulePath.includes(excludePattern)
    )

    if (!shouldExclude) {
      // 当使用 eager: true 时，moduleContent 直接就是模块内容，不是函数
      filteredModules.push({
        path: modulePath,
        module: moduleContent as Record<string, unknown>
      })
    }
  }

  return filteredModules
}

/**
 * 检查对象是否实现了 LifeCycle 接口
 * 通过鸭子类型检查：是否有 start 和 stop 方法
 */
function isLifeCycle(obj: unknown): obj is { start: () => void; stop: () => void } {
  if (!obj || typeof obj !== 'object') {
    return false
  }
  const candidate = obj as Record<string, unknown>
  return typeof candidate.start === 'function' && typeof candidate.stop === 'function'
}

/**
 * 过滤出实现了 LifeCycle 接口的模块
 * @param modules 扫描结果对象
 * @returns 实现了 LifeCycle 接口的模块数组
 */
function filterLifeCycleModules(modules: Record<string, unknown>): DiscoveredModule[] {
  const lifeCycleModules: DiscoveredModule[] = []

  for (const [modulePath, moduleContent] of Object.entries(modules)) {
    if (!moduleContent || typeof moduleContent !== 'object') {
      continue
    }

    // 类型断言：确保 moduleContent 是对象类型
    const moduleObj = moduleContent as Record<string, unknown>

    // 用于记录该文件中找到的导出（实例优先于类）
    const foundClasses: DiscoveredModule[] = []
    const foundInstances: DiscoveredModule[] = []

    // 遍历模块的所有导出，查找实现了 LifeCycle 接口的类或对象
    for (const [exportName, exportValue] of Object.entries(moduleObj)) {
      // 跳过 __esModule 等特殊属性
      if (exportName.startsWith('__')) {
        continue
      }

      // 情况1: 导出的是一个类
      if (typeof exportValue === 'function') {
        // 检查类的原型是否有 start 和 stop 方法
        if (isLifeCycle(exportValue.prototype)) {
          log.info(`[Scan] 找到生命周期类: ${modulePath} -> ${exportName}`)
          foundClasses.push({
            path: modulePath,
            module: moduleObj,
            exportName: exportName
          })
          continue
        }
      }

      // 情况2: 导出的是一个对象实例（单例模式）
      if (isLifeCycle(exportValue)) {
        log.info(`[Scan] 找到生命周期对象实例: ${modulePath} -> ${exportName}`)
        foundInstances.push({
          path: modulePath,
          module: moduleObj,
          exportName: exportName
        })
        continue
      }
    }

    // 优先使用实例，如果没有实例才使用类
    // 这样可以避免同时导出类和实例时的重复注册
    if (foundInstances.length > 0) {
      lifeCycleModules.push(...foundInstances)
      if (foundClasses.length > 0) {
        log.debug(`[Scan] ${modulePath} 同时导出类和实例，优先使用实例，跳过类导出`)
      }
    } else {
      lifeCycleModules.push(...foundClasses)
    }
  }

  return lifeCycleModules
}
