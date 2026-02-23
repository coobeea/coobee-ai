/**
 * Extension 注册中心
 *
 * 管理所有 Extension 的注册信息（hooks、tools、gatewayMethods）。
 * 支持按 extensionId 注册和批量卸载，为热插拔提供基础。
 */

import type { ToolDefinition } from '../../ai/tools/types';
import type { MethodHandler } from '../../gateway/protocol/types';
import type {
  ExtensionHookName,
  RegisteredExtensionHook,
  RegisteredExtensionTool,
  RegisteredExtensionMethod,
  RegisteredExtensionSkillDir,
  RegisteredChannel,
  RegisteredHttpRoute,
  RegisteredBackgroundService
} from './types';

/** 受保护的 Gateway 核心命名空间，Extension 不可覆盖 */
const PROTECTED_NAMESPACES = ['chat', 'stream', 'worker', 'hitl'];

export class ExtensionRegistry {
  private hooks: RegisteredExtensionHook[] = [];
  private tools: RegisteredExtensionTool[] = [];
  private gatewayMethods: RegisteredExtensionMethod[] = [];
  private skillDirs: RegisteredExtensionSkillDir[] = [];
  private channels: RegisteredChannel[] = [];
  private httpRoutes: RegisteredHttpRoute[] = [];
  private backgroundServices: RegisteredBackgroundService[] = [];
  /** 失败的 Extension（extensionId → 错误信息） */
  private failedExtensions = new Map<string, string>();

  // --- 工具 ---

  registerTool(extensionId: string, tool: ToolDefinition): void {
    if (this.tools.some((t) => t.tool.name === tool.name)) {
      throw new Error(`[ExtensionRegistry] Tool "${tool.name}" already registered`);
    }
    this.tools.push({ extensionId, tool });
  }

  unregisterToolsByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.tools = this.tools.filter((t) => {
      if (t.extensionId === extensionId) {
        removed.push(t.tool.name);
        return false;
      }
      return true;
    });
    return removed;
  }

  getTools(): RegisteredExtensionTool[] {
    return [...this.tools];
  }

  // --- Hook ---

  registerHook<K extends ExtensionHookName>(hook: RegisteredExtensionHook<K>): void {
    this.hooks.push(hook as unknown as RegisteredExtensionHook);
  }

  unregisterHooksByExtension(extensionId: string): void {
    this.hooks = this.hooks.filter((h) => h.extensionId !== extensionId);
  }

  getHooks<K extends ExtensionHookName>(name: K): RegisteredExtensionHook<K>[] {
    return this.hooks
      .filter((h) => h.hookName === name)
      .sort((a, b) => b.priority - a.priority) as unknown as RegisteredExtensionHook<K>[];
  }

  // --- Gateway 方法 ---

  registerGatewayMethod(extensionId: string, method: string, handler: MethodHandler): void {
    // 保护核心命名空间
    const namespace = method.split('.')[0];
    if (PROTECTED_NAMESPACES.includes(namespace)) {
      throw new Error(`[ExtensionRegistry] Cannot register method "${method}": namespace "${namespace}" is protected`);
    }
    if (this.gatewayMethods.some((m) => m.method === method)) {
      throw new Error(`[ExtensionRegistry] Gateway method "${method}" already registered`);
    }
    this.gatewayMethods.push({ extensionId, method, handler });
  }

  unregisterGatewayMethodsByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.gatewayMethods = this.gatewayMethods.filter((m) => {
      if (m.extensionId === extensionId) {
        removed.push(m.method);
        return false;
      }
      return true;
    });
    return removed;
  }

  getGatewayMethods(): RegisteredExtensionMethod[] {
    return [...this.gatewayMethods];
  }

  // --- Skill 目录 ---

  registerSkillDir(extensionId: string, dir: string): void {
    // 同一扩展可以只贡献一个 Skill 目录，重复注册忽略
    if (this.skillDirs.some((s) => s.extensionId === extensionId && s.dir === dir)) return;
    this.skillDirs.push({ extensionId, dir });
  }

  unregisterSkillDirsByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.skillDirs = this.skillDirs.filter((s) => {
      if (s.extensionId === extensionId) {
        removed.push(s.dir);
        return false;
      }
      return true;
    });
    return removed;
  }

  getSkillDirs(): RegisteredExtensionSkillDir[] {
    return [...this.skillDirs];
  }

  // --- Channel ---

  registerChannel(extensionId: string, channel: RegisteredChannel['channel']): void {
    if (this.channels.some((c) => c.channel.id === channel.id)) {
      throw new Error(`[ExtensionRegistry] Channel "${channel.id}" already registered`);
    }
    this.channels.push({ extensionId, channel });
  }

  unregisterChannelsByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.channels = this.channels.filter((c) => {
      if (c.extensionId === extensionId) {
        removed.push(c.channel.id);
        return false;
      }
      return true;
    });
    return removed;
  }

  getChannels(): RegisteredChannel[] {
    return [...this.channels];
  }

  // --- HTTP Route ---

  registerHttpRoute(extensionId: string, route: RegisteredHttpRoute['route']): void {
    if (this.httpRoutes.some((r) => r.route.path === route.path && r.route.method === route.method)) {
      throw new Error(`[ExtensionRegistry] HTTP Route "${route.method} ${route.path}" already registered`);
    }
    this.httpRoutes.push({ extensionId, route });
  }

  unregisterHttpRoutesByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.httpRoutes = this.httpRoutes.filter((r) => {
      if (r.extensionId === extensionId) {
        removed.push(`${r.route.method} ${r.route.path}`);
        return false;
      }
      return true;
    });
    return removed;
  }

  getHttpRoutes(): RegisteredHttpRoute[] {
    return [...this.httpRoutes];
  }

  // --- Background Service ---

  registerService(extensionId: string, service: RegisteredBackgroundService['service']): void {
    if (this.backgroundServices.some((s) => s.service.id === service.id)) {
      throw new Error(`[ExtensionRegistry] Service "${service.id}" already registered`);
    }
    this.backgroundServices.push({ extensionId, service });
  }

  unregisterServicesByExtension(extensionId: string): string[] {
    const removed: string[] = [];
    this.backgroundServices = this.backgroundServices.filter((s) => {
      if (s.extensionId === extensionId) {
        removed.push(s.service.id);
        return false;
      }
      return true;
    });
    return removed;
  }

  getServices(): RegisteredBackgroundService[] {
    return [...this.backgroundServices];
  }

  // --- 整体 ---

  unregisterAll(extensionId: string): void {
    this.unregisterToolsByExtension(extensionId);
    this.unregisterHooksByExtension(extensionId);
    this.unregisterGatewayMethodsByExtension(extensionId);
    this.unregisterSkillDirsByExtension(extensionId);
    this.unregisterChannelsByExtension(extensionId);
    this.unregisterHttpRoutesByExtension(extensionId);
    this.unregisterServicesByExtension(extensionId);
  }

  getExtensionIds(): string[] {
    const ids = new Set<string>();
    for (const t of this.tools) ids.add(t.extensionId);
    for (const h of this.hooks) ids.add(h.extensionId);
    for (const m of this.gatewayMethods) ids.add(m.extensionId);
    for (const s of this.skillDirs) ids.add(s.extensionId);
    for (const c of this.channels) ids.add(c.extensionId);
    for (const r of this.httpRoutes) ids.add(r.extensionId);
    for (const s of this.backgroundServices) ids.add(s.extensionId);
    return [...ids];
  }

  clear(): void {
    this.hooks = [];
    this.tools = [];
    this.gatewayMethods = [];
    this.skillDirs = [];
    this.channels = [];
    this.httpRoutes = [];
    this.backgroundServices = [];
    this.failedExtensions.clear();
  }

  // --- 失败Extension管理 ---

  /**
   * 标记 Extension 加载/注册失败
   */
  markExtensionFailed(extensionId: string, error: string): void {
    this.failedExtensions.set(extensionId, error);
  }

  /**
   * 获取失败的 Extension 列表
   */
  getFailedExtensions(): Array<{ extensionId: string; error: string }> {
    return Array.from(this.failedExtensions.entries()).map(([extensionId, error]) => ({
      extensionId,
      error
    }));
  }

  /**
   * 检查 Extension 是否失败
   */
  isExtensionFailed(extensionId: string): boolean {
    return this.failedExtensions.has(extensionId);
  }

  /**
   * 清除 Extension 的失败标记（用于重试）
   */
  clearExtensionFailure(extensionId: string): void {
    this.failedExtensions.delete(extensionId);
  }
}
