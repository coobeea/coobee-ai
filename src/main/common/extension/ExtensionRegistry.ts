/**
 * Extension 注册中心
 *
 * 管理所有 Extension 的注册信息（hooks、tools、gatewayMethods）。
 * 支持按 extensionId 注册和批量卸载，为热插拔提供基础。
 */

import type { ToolDefinition } from '../../ai/tools/types'
import type { MethodHandler } from '../../gateway/protocol/types'
import type {
  ExtensionHookName,
  RegisteredExtensionHook,
  RegisteredExtensionTool,
  RegisteredExtensionMethod,
  RegisteredExtensionSkillDir
} from './types'

/** 受保护的 Gateway 核心命名空间，Extension 不可覆盖 */
const PROTECTED_NAMESPACES = ['chat', 'stream', 'worker', 'hitl']

export class ExtensionRegistry {
  private hooks: RegisteredExtensionHook[] = []
  private tools: RegisteredExtensionTool[] = []
  private gatewayMethods: RegisteredExtensionMethod[] = []
  private skillDirs: RegisteredExtensionSkillDir[] = []

  // --- 工具 ---

  registerTool(extensionId: string, tool: ToolDefinition): void {
    if (this.tools.some((t) => t.tool.name === tool.name)) {
      throw new Error(`[ExtensionRegistry] Tool "${tool.name}" already registered`)
    }
    this.tools.push({ extensionId, tool })
  }

  unregisterToolsByExtension(extensionId: string): string[] {
    const removed: string[] = []
    this.tools = this.tools.filter((t) => {
      if (t.extensionId === extensionId) {
        removed.push(t.tool.name)
        return false
      }
      return true
    })
    return removed
  }

  getTools(): RegisteredExtensionTool[] {
    return [...this.tools]
  }

  // --- Hook ---

  registerHook<K extends ExtensionHookName>(hook: RegisteredExtensionHook<K>): void {
    this.hooks.push(hook as unknown as RegisteredExtensionHook)
  }

  unregisterHooksByExtension(extensionId: string): void {
    this.hooks = this.hooks.filter((h) => h.extensionId !== extensionId)
  }

  getHooks<K extends ExtensionHookName>(name: K): RegisteredExtensionHook<K>[] {
    return this.hooks
      .filter((h) => h.hookName === name)
      .sort((a, b) => b.priority - a.priority) as unknown as RegisteredExtensionHook<K>[]
  }

  // --- Gateway 方法 ---

  registerGatewayMethod(extensionId: string, method: string, handler: MethodHandler): void {
    // 保护核心命名空间
    const namespace = method.split('.')[0]
    if (PROTECTED_NAMESPACES.includes(namespace)) {
      throw new Error(
        `[ExtensionRegistry] Cannot register method "${method}": namespace "${namespace}" is protected`
      )
    }
    if (this.gatewayMethods.some((m) => m.method === method)) {
      throw new Error(`[ExtensionRegistry] Gateway method "${method}" already registered`)
    }
    this.gatewayMethods.push({ extensionId, method, handler })
  }

  unregisterGatewayMethodsByExtension(extensionId: string): string[] {
    const removed: string[] = []
    this.gatewayMethods = this.gatewayMethods.filter((m) => {
      if (m.extensionId === extensionId) {
        removed.push(m.method)
        return false
      }
      return true
    })
    return removed
  }

  getGatewayMethods(): RegisteredExtensionMethod[] {
    return [...this.gatewayMethods]
  }

  // --- Skill 目录 ---

  registerSkillDir(extensionId: string, dir: string): void {
    // 同一扩展可以只贡献一个 Skill 目录，重复注册忽略
    if (this.skillDirs.some((s) => s.extensionId === extensionId && s.dir === dir)) return
    this.skillDirs.push({ extensionId, dir })
  }

  unregisterSkillDirsByExtension(extensionId: string): string[] {
    const removed: string[] = []
    this.skillDirs = this.skillDirs.filter((s) => {
      if (s.extensionId === extensionId) {
        removed.push(s.dir)
        return false
      }
      return true
    })
    return removed
  }

  getSkillDirs(): RegisteredExtensionSkillDir[] {
    return [...this.skillDirs]
  }

  // --- 整体 ---

  unregisterAll(extensionId: string): void {
    this.unregisterToolsByExtension(extensionId)
    this.unregisterHooksByExtension(extensionId)
    this.unregisterGatewayMethodsByExtension(extensionId)
    this.unregisterSkillDirsByExtension(extensionId)
  }

  getExtensionIds(): string[] {
    const ids = new Set<string>()
    for (const t of this.tools) ids.add(t.extensionId)
    for (const h of this.hooks) ids.add(h.extensionId)
    for (const m of this.gatewayMethods) ids.add(m.extensionId)
    for (const s of this.skillDirs) ids.add(s.extensionId)
    return [...ids]
  }

  clear(): void {
    this.hooks = []
    this.tools = []
    this.gatewayMethods = []
    this.skillDirs = []
  }
}
