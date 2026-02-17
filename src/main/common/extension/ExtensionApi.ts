/**
 * ExtensionApi 工厂
 *
 * 为每个 Extension 构建独立的 api 对象，供 register() 调用。
 * 包含 services 属性提供解耦的系统服务访问。
 */

import { ExtensionRegistry } from './ExtensionRegistry'
import type {
  ExtensionApi,
  ExtensionOrigin,
  ExtensionLogger,
  ExtensionServices,
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
    services: createExtensionServices(),
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
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager')
        return hitlApprovalManager.waitForSingleDecision(approvalId, timeoutMs)
      },
      submitSingleDecision(approvalId, decision) {
        // 同步版本 — 需要 top-level await 或者调用方已确保模块加载
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { hitlApprovalManager } = require('../../ai/hitl/HitlApprovalManager')
        return hitlApprovalManager.submitSingleDecision(approvalId, decision)
      },
      async cleanupSession(sessionId) {
        const { hitlApprovalManager } = await import('../../ai/hitl/HitlApprovalManager')
        hitlApprovalManager.cleanupSession(sessionId)
      }
    },
    events: {
      emit(sessionId, chunk) {
        // 统一分发：写文件 + 推前端（通过 AgentEventWriter.dispatch）
        // 不再需要手动同时调用 StreamEmitter 和 EventWriter
        import('../../ai/AgentEventWriter')
          .then(({ AgentEventWriter }) => {
            AgentEventWriter.dispatchForSession(sessionId, chunk as never)
          })
          .catch(() => {
            // 分发失败不阻断
          })
      }
    }
  }
}
