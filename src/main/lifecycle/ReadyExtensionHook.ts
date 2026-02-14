/**
 * Extension Hook — Extension 系统初始化
 *
 * 在 READY 阶段加载所有 Extension，注入 ToolRegistry / Gateway，
 * 初始化全局 ExtensionManager，启动 fs.watch 热插拔。
 *
 * 执行顺序：
 *   ReadyGatewayHook (45) → ReadyExtensionHook (50) → ReadyIpcRegistrationHook (50)
 *
 * 前置条件：Gateway 已初始化（由 ReadyGatewayHook 完成）
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

export const ReadyExtensionHook: LifecycleHook = {
  name: 'ready-extension',
  phase: LifecyclePhase.READY,
  priority: 50, // 在 Gateway(45) 之后
  critical: false, // Extension 加载失败不阻止应用启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyExtensionHook] Initializing Extension system...')

    try {
      const { Env } = await import('@main/common/env')
      const { ExtensionRegistry, ExtensionLoader, ExtensionManager } =
        await import('@main/common/extension')
      const { ToolRegistry } = await import('@main/ai/tools/registry')

      // 1. 获取搜索路径
      const searchPaths = await Env.getExtensionSearchPaths()

      // 2. 创建注册中心和加载器
      const registry = new ExtensionRegistry()
      const loader = new ExtensionLoader(registry)

      // 3. 加载所有 Extension
      await loader.loadAll(searchPaths)

      // 4. 将 Extension 工具注入 ToolRegistry
      for (const { tool } of registry.getTools()) {
        try {
          ToolRegistry.getInstance().register(tool)
        } catch (err) {
          log.warn(`[ReadyExtensionHook] Failed to register extension tool "${tool.name}":`, err)
        }
      }

      // 5. 初始化全局管理器
      ExtensionManager.initialize(registry)

      // 6. 启动 fs.watch 热插拔
      loader.watch(searchPaths)

      const extIds = registry.getExtensionIds()
      log.info(
        `[ReadyExtensionHook] Extension system initialized — ${extIds.length} extensions loaded`
      )
    } catch (error) {
      log.error('[ReadyExtensionHook] Failed to initialize Extension system:', error)
    }
  }
}
