/**
 * Method Adapter - RPC 方法适配器
 *
 * 将传统的 Gateway RPC 方法适配到统一协议
 */

import { log } from '@main/common/logger';
import type { MethodHandler } from '../../protocol/types';
import type { UnifiedHandler, UnifiedContext } from '../types';

/**
 * 将 Gateway MethodHandler 适配为 UnifiedHandler
 */
export function adaptMethod(methodHandler: MethodHandler): UnifiedHandler {
  return async (payload: unknown, context: UnifiedContext) => {
    try {
      // 调用原始 MethodHandler（需要传递 params 和 ctx 两个参数）
      // 注：UnifiedContext 不包含完整的 MethodContext，使用类型断言
      const result = await methodHandler(
        payload as Record<string, unknown>,
        {
          clientId: context.client?.connectionId || '',
          ws: {} as never,
          meta: {} as never
        } as never
      );

      log.debug(`[MethodAdapter] 方法调用成功，上下文: ${context.client?.connectionId || 'unknown'}`);

      return result;
    } catch (error) {
      log.error('[MethodAdapter] 方法调用失败', error);
      throw error;
    }
  };
}

/**
 * 批量适配方法组
 */
export function adaptMethodGroup(methods: Map<string, MethodHandler>): Map<string, UnifiedHandler> {
  const adapted = new Map<string, UnifiedHandler>();

  for (const [name, handler] of methods.entries()) {
    adapted.set(name, adaptMethod(handler));
  }

  log.info(`[MethodAdapter] 已适配 ${adapted.size} 个方法`);

  return adapted;
}
