import { log } from '@main/common/logger'

// ==================== 模块发现 ====================

export interface DiscoveredModule {
  path: string
  module: Record<string, unknown>
}

/**
 * 扫描API目录，只支持两种导出模式：
 * 1. export async function functionName
 * 2. export default class ClassName (类方法可使用装饰器)
 */
export function discoverApiModules(): DiscoveredModule[] {
  log.info('[ApiLoader] Starting to discover API modules...')

  // Vite import.meta.glob requires a literal string for the pattern.
  const modules = import.meta.glob('../../api/**/*.ts', { eager: true })

  const discoveredModules: DiscoveredModule[] = []
  const moduleCount = Object.keys(modules).length
  log.info(`[ApiLoader] Found ${moduleCount} potential API module files.`)

  for (const moduleRelativePath in modules) {
    const moduleContent = modules[moduleRelativePath] as Record<string, unknown>
    if (moduleContent) {
      discoveredModules.push({ path: moduleRelativePath, module: moduleContent })
      log.debug(`[ApiLoader] Discovered module: ${moduleRelativePath}`)
    } else {
      log.warn(`[ApiLoader] Failed to load module: ${moduleRelativePath}`)
    }
  }

  if (discoveredModules.length > 0) {
    log.info(`[ApiLoader] Successfully processed ${discoveredModules.length} API modules.`)
  } else {
    log.info('[ApiLoader] No API modules found in src/main/api/.')
  }

  log.info('[ApiLoader] API module discovery complete.')
  return discoveredModules
}
