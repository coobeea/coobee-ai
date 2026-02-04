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
 * 扫描生命周期 Hook 文件
 * 扫描 @main/lifecycle 目录下所有 *Hook.ts 文件
 */
export function scanLifeCycleHooks(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描生命周期Hook文件...')

  const modules = import.meta.glob('@main/lifecycle/**/*Hook.ts', { eager: true })
  const totalFound = Object.keys(modules).length

  log.info(`[Scan] 发现 ${totalFound} 个潜在的Hook文件:`)
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`)
  })

  const filteredModules = filterModules(modules, ['BaseHook'])
  const filteredCount = filteredModules.length

  log.info(`[Scan] 过滤后剩余 ${filteredCount} 个Hook文件:`)
  filteredModules.forEach((discoveredModule, index) => {
    log.info(`[Scan]   ${index + 1}. ${discoveredModule.path}`)
  })

  log.info('[Scan] 生命周期Hook扫描完成')

  return filteredModules
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
