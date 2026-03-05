/**
 * ExtensionApi 工厂
 *
 * 为每个 Extension 构建独立的 api 对象，供 register() 调用。
 * 包含 services 属性提供解耦的系统服务访问。
 */

import { ExtensionRegistry } from './ExtensionRegistry';
import { ChannelManager } from '../../channels/ChannelManager';
import type { ChannelPlugin } from '../../channels/types';
import type {
  ExtensionApi,
  ExtensionOrigin,
  ExtensionLogger,
  ExtensionServices,
  ExtensionEventBus,
  ExtensionHookName,
  ExtensionHookHandler,
  CronJobConfig
} from './types';

/**
 * 创建 Extension 专属日志器
 */
function createExtensionLogger(extensionId: string): ExtensionLogger {
  const prefix = `[Extension:${extensionId}]`;
  // 使用 console.log 输出，这些日志会出现在 stdout 中
  // 如果需要写入日志文件，需要在应用层面捕获 console 输出
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args)
  };
}

/**
 * 验证 ChannelPlugin
 */
function validateChannelPlugin(plugin: ChannelPlugin): void {
  // 1. 检查必填字段
  if (!plugin.id || typeof plugin.id !== 'string') {
    throw new Error('ChannelPlugin.id is required and must be a string');
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error('ChannelPlugin.name is required and must be a string');
  }

  // 2. 检查 lifecycle
  if (!plugin.lifecycle) {
    throw new Error(`ChannelPlugin "${plugin.id}" must have lifecycle hooks`);
  }

  if (typeof plugin.lifecycle.start !== 'function') {
    throw new Error(`ChannelPlugin "${plugin.id}" must implement lifecycle.start()`);
  }

  if (typeof plugin.lifecycle.stop !== 'function') {
    throw new Error(`ChannelPlugin "${plugin.id}" must implement lifecycle.stop()`);
  }

  // 3. 检查 ID 格式
  if (!/^[a-z0-9-]+$/.test(plugin.id)) {
    throw new Error(`ChannelPlugin ID "${plugin.id}" is invalid. Use lowercase letters, numbers, and hyphens only.`);
  }
}

/**
 * 为单个 Extension 构建 ExtensionApi
 */
export function createExtensionApi(
  extensionId: string,
  name: string,
  origin: ExtensionOrigin,
  registry: ExtensionRegistry,
  bus?: ExtensionEventBus
): ExtensionApi {
  return {
    id: extensionId,
    name,
    origin,
    logger: createExtensionLogger(extensionId),
    services: createExtensionServices(),
    eventBus: bus || createEventBusWrapper(null),
    registerTool(tool) {
      registry.registerTool(extensionId, tool);
    },
    on<K extends ExtensionHookName>(hookName: K, handler: ExtensionHookHandler<K>, opts?: { priority?: number }) {
      registry.registerHook<K>({
        extensionId,
        hookName,
        handler,
        priority: opts?.priority ?? 0
      });
    },
    registerGatewayMethod(method, handler) {
      registry.registerGatewayMethod(extensionId, method, handler);
    },
    registerChannel(config) {
      registry.registerChannel(extensionId, config);
    },
    async registerChannelPlugin(plugin) {
      // 1. 验证 Plugin
      validateChannelPlugin(plugin);

      // 2. 注册到 ExtensionRegistry
      registry.registerChannelPlugin(extensionId, plugin);

      // 3. 注册到 ChannelManager
      try {
        const channelManager = ChannelManager.getInstance();
        channelManager.registerChannelPlugin(plugin);
      } catch (err) {
        console.error(`[ExtensionApi] Failed to register ChannelPlugin "${plugin.id}":`, err);
        throw err;
      }
    },
    registerHttpRoute(config) {
      registry.registerHttpRoute(extensionId, config);
    },
    registerService(service) {
      registry.registerService(extensionId, service);
    },
    registerCronJob(config: CronJobConfig) {
      registry.registerCronJob(extensionId, config);
    }
  };
}

/**
 * 创建 Extension EventBus 包装器
 *
 * 将系统 EventBus 包装为 ExtensionEventBus 接口。
 * 由 ReadyExtensionHook 在 app 就绪后导入并传递。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEventBusWrapper(bus: any): ExtensionEventBus {
  if (!bus) {
    // Fallback：如果未提供 eventBus，返回 no-op 实现
    return {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      emit() {}
    };
  }

  return {
    on(event, handler) {
      bus.on(event, handler);
    },
    off(event, handler) {
      bus.off(event, handler);
    },
    emit(event, data) {
      bus.emit(event, data);
    }
  };
}

/**
 * 创建 Extension 服务集合
 *
 * 通过懒加载（dynamic import）访问核心模块，
 * 避免在 Extension 系统初始化时产生循环依赖。
 */
function createExtensionServices(): ExtensionServices {
  return {
    hitl: {
      async waitForSingleDecision(approvalId, timeoutMs) {
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager');
        return hitlApprovalManager.waitForSingleDecision(approvalId, timeoutMs);
      },
      submitSingleDecision(approvalId, decision) {
        // 同步版本 — 需要 top-level await 或者调用方已确保模块加载
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { hitlApprovalManager } = require('../../ai/hitl/HitlApprovalManager');
        return hitlApprovalManager.submitSingleDecision(approvalId, decision);
      },
      async cleanupSession(sessionId) {
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager');
        hitlApprovalManager.cleanupSession(sessionId);
      }
    },
    events: {
      emit(sessionId, chunk) {
        // 统一分发：写文件 + 推前端（通过 AgentEventWriter.dispatch）
        // 不再需要手动同时调用 StreamEmitter 和 EventWriter
        import('../../ai/AgentEventWriter')
          .then(({ AgentEventWriter }) => {
            AgentEventWriter.dispatchForSession(sessionId, chunk as never);
          })
          .catch(() => {
            // 分发失败不阻断
          });
      }
    }
  };
}
