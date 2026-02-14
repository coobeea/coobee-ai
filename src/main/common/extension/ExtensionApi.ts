/**
 * ExtensionApi 工厂
 *
 * 为每个 Extension 构建独立的 api 对象，供 register() 调用。
 */

import { ExtensionRegistry } from './ExtensionRegistry'
import type {
  ExtensionApi,
  ExtensionOrigin,
  ExtensionLogger,
  ExtensionHookName,
  ExtensionHookHandler
} from './types'

/**
 * 创建 Extension 专属日志器
 */
function createExtensionLogger(extensionId: string): ExtensionLogger {
  const prefix = `[Extension:${extensionId}]`
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args)
  }
}

/**
 * 为单个 Extension 构建 ExtensionApi
 */
export function createExtensionApi(
  extensionId: string,
  name: string,
  origin: ExtensionOrigin,
  registry: ExtensionRegistry
): ExtensionApi {
  return {
    id: extensionId,
    name,
    origin,
    logger: createExtensionLogger(extensionId),
    registerTool(tool) {
      registry.registerTool(extensionId, tool)
    },
    on<K extends ExtensionHookName>(
      hookName: K,
      handler: ExtensionHookHandler<K>,
      opts?: { priority?: number }
    ) {
      registry.registerHook<K>({
        extensionId,
        hookName,
        handler,
        priority: opts?.priority ?? 0
      })
    },
    registerGatewayMethod(method, handler) {
      registry.registerGatewayMethod(extensionId, method, handler)
    }
  }
}
