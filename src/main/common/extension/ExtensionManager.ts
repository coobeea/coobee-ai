/**
 * Extension 全局管理器
 *
 * 提供全局访问 ExtensionRegistry 和 ExtensionHookRunner 的能力。
 * 应用启动时由 ReadyExtensionHook 调用 initialize()。
 */

import { ExtensionRegistry } from './ExtensionRegistry'
import { ExtensionHookRunner } from './ExtensionHookRunner'

let _registry: ExtensionRegistry | null = null
let _hookRunner: ExtensionHookRunner | null = null

export class ExtensionManager {
  /** 初始化（应用启动时调用一次） */
  static initialize(registry: ExtensionRegistry): void {
    _registry = registry
    _hookRunner = new ExtensionHookRunner(registry)
  }

  /** 获取注册中心 */
  static getRegistry(): ExtensionRegistry | null {
    return _registry
  }

  /** 获取 Hook 执行引擎 */
  static getHookRunner(): ExtensionHookRunner | null {
    return _hookRunner
  }

  /** 重置（测试用） */
  static reset(): void {
    _registry = null
    _hookRunner = null
  }
}
