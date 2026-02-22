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

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

/** 模块级引用，供退出时清理 */
let activeLoader: { stopWatch(): void } | null = null;

export const ReadyExtensionHook: LifecycleHook = {
  name: 'ready-extension',
  phase: LifecyclePhase.READY,
  priority: 50, // 在 Gateway(45) 之后
  critical: false, // Extension 加载失败不阻止应用启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyExtensionHook] Initializing Extension system...');

    try {
      const { Env } = await import('@main/common/env');
      const { ExtensionRegistry, ExtensionLoader, ExtensionManager } = await import('@main/common/extension');
      const { ToolRegistry } = await import('@main/ai/tools/registry');
      const { eventBus } = await import('@main/common/eventbus');
      const { ChannelManager } = await import('@main/channels/ChannelManager');

      // 1. 获取全局搜索路径（只加载 builtin 和 user Extension）
      const globalSearchPaths = [Env.paths.builtinExtensionsDir, Env.paths.userExtensionsDir];

      // 2. 创建注册中心和加载器（传递 eventBus 引用）
      const registry = new ExtensionRegistry();
      const loader = new ExtensionLoader(registry, eventBus);

      // 3. 加载全局 Extension（任务级 Extension 由 AgentExecutor 动态加载）
      await loader.loadAll(globalSearchPaths);

      // 4. 将 Extension 工具注入 ToolRegistry
      for (const { tool } of registry.getTools()) {
        try {
          ToolRegistry.getInstance().register(tool);
        } catch (err) {
          log.warn(`[ReadyExtensionHook] Failed to register extension tool "${tool.name}":`, err);
        }
      }

      // 5. 初始化全局管理器（传递 loader 引用，用于动态加载任务级 Extension）
      ExtensionManager.initialize(registry, loader);

      // 6. 启动所有已注册的 Background Service
      for (const { service } of registry.getServices()) {
        try {
          await service.start();
          log.info(`[ReadyExtensionHook] Started background service: ${service.id}`);
        } catch (err) {
          log.error(`[ReadyExtensionHook] Failed to start background service "${service.id}":`, err);
        }
      }

      // 7. 并发启动所有已注册的 Channel
      const channelManager = ChannelManager.getInstance();
      await channelManager.startAll();

      // 8. 启动 fs.watch 热插拔（只监听全局目录）
      loader.watch(globalSearchPaths);
      activeLoader = loader;

      const extIds = registry.getExtensionIds();
      log.info(`[ReadyExtensionHook] Extension system initialized — ${extIds.length} extensions loaded`);
    } catch (error) {
      log.error('[ReadyExtensionHook] Failed to initialize Extension system:', error);
    }
  }
};

/**
 * 退出时停止 Extension 文件监听
 */
export const BeforeQuitExtensionHook: LifecycleHook = {
  name: 'before-quit-extension',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 30, // 比 Infra(40) 和 Process(50) 更早清理
  critical: false,

  async execute(): Promise<void> {
    if (activeLoader) {
      activeLoader.stopWatch();
      activeLoader = null;
      log.info('[BeforeQuitExtensionHook] Extension watchers stopped');
    }

    try {
      const { ExtensionManager } = await import('@main/common/extension');
      const { ChannelManager } = await import('@main/channels/ChannelManager');

      const registry = ExtensionManager.getRegistry();

      // 停止所有 Channel
      const channelManager = ChannelManager.getInstance();
      await channelManager.stopAll();

      // 停止所有 Background Service
      if (registry) {
        for (const { service } of registry.getServices()) {
          try {
            await service.stop();
            log.info(`[BeforeQuitExtensionHook] Stopped background service: ${service.id}`);
          } catch (err) {
            log.error(`[BeforeQuitExtensionHook] Failed to stop background service "${service.id}":`, err);
          }
        }
      }
    } catch (err) {
      log.error('[BeforeQuitExtensionHook] Failed to stop channels or services:', err);
    }
  }
};
