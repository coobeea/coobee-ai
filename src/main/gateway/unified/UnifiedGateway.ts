/**
 * 统一 Gateway
 *
 * 提供统一的通信接口，兼容 RPC、Event、REST 三种协议
 * 新旧协议并存，渐进式迁移
 */

import { log } from '@main/common/logger';
import type {
  UnifiedRequest,
  UnifiedResponse,
  UnifiedEvent,
  UnifiedHandler,
  UnifiedContext,
  UnifiedRequestType
} from './types';

/** 路由项 */
interface RouteEntry {
  handler: UnifiedHandler;
  type: UnifiedRequestType;
}

/**
 * 统一 Gateway
 */
export class UnifiedGateway {
  private routes = new Map<string, RouteEntry>();
  private eventHandlers = new Map<string, Set<UnifiedHandler>>();

  /**
   * 注册路由
   */
  register(target: string, handler: UnifiedHandler, type: UnifiedRequestType = 'rpc'): void {
    if (this.routes.has(target)) {
      log.warn(`[UnifiedGateway] 覆盖已存在的路由: ${target}`);
    }

    this.routes.set(target, { handler, type });
    log.debug(`[UnifiedGateway] 注册路由: ${target} (${type})`);
  }

  /**
   * 注销路由
   */
  unregister(target: string): boolean {
    const deleted = this.routes.delete(target);
    if (deleted) {
      log.debug(`[UnifiedGateway] 注销路由: ${target}`);
    }
    return deleted;
  }

  /**
   * 注册事件处理器
   */
  on(event: string, handler: UnifiedHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }

    this.eventHandlers.get(event)!.add(handler);
    log.debug(`[UnifiedGateway] 注册事件处理器: ${event}`);

    // 返回取消订阅函数
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(event);
        }
      }
    };
  }

  /**
   * 调用方法（RPC）
   */
  async call<TReq = unknown, TRes = unknown>(
    target: string,
    payload?: TReq,
    context?: Partial<UnifiedContext>
  ): Promise<UnifiedResponse<TRes>> {
    const request: UnifiedRequest = {
      type: 'rpc',
      target,
      payload,
      requestId: this.generateRequestId()
    };

    return this.dispatch(request, {
      type: 'rpc',
      ...context
    });
  }

  /**
   * 发送事件（Event）
   */
  async emit<T = unknown>(event: string, data: T, context?: Partial<UnifiedContext>): Promise<void> {
    const unifiedEvent: UnifiedEvent<T> = {
      event,
      data,
      timestamp: Date.now()
    };

    const handlers = this.eventHandlers.get(event);
    if (!handlers || handlers.size === 0) {
      log.debug(`[UnifiedGateway] 没有事件处理器: ${event}`);
      return;
    }

    // 并行执行所有处理器
    await Promise.allSettled(
      Array.from(handlers).map((handler) =>
        handler(unifiedEvent, {
          type: 'event',
          ...context
        })
      )
    );
  }

  /**
   * HTTP 请求（REST）
   */
  async request<TReq = unknown, TRes = unknown>(
    path: string,
    payload?: TReq,
    context?: Partial<UnifiedContext>
  ): Promise<UnifiedResponse<TRes>> {
    const request: UnifiedRequest = {
      type: 'http',
      target: path,
      payload,
      requestId: this.generateRequestId()
    };

    return this.dispatch(request, {
      type: 'http',
      ...context
    });
  }

  /**
   * 分发请求
   */
  private async dispatch<TRes = unknown>(
    request: UnifiedRequest,
    context: UnifiedContext
  ): Promise<UnifiedResponse<TRes>> {
    const startTime = Date.now();

    try {
      // 查找路由
      const route = this.routes.get(request.target);
      if (!route) {
        return {
          success: false,
          error: {
            code: 'ROUTE_NOT_FOUND',
            message: `路由不存在: ${request.target}`
          },
          requestId: request.requestId
        };
      }

      // 执行处理器
      const result = await route.handler(request.payload, context);

      const duration = Date.now() - startTime;
      log.debug(`[UnifiedGateway] 请求成功: ${request.target} (${duration}ms)`);

      return {
        success: true,
        data: result as TRes,
        requestId: request.requestId
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error(`[UnifiedGateway] 请求失败: ${request.target} (${duration}ms)`, error);

      return {
        success: false,
        error: {
          code: 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : String(error),
          details: error
        },
        requestId: request.requestId
      };
    }
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * 获取已注册路由列表
   */
  getRoutes(): Array<{ target: string; type: UnifiedRequestType }> {
    return Array.from(this.routes.entries()).map(([target, { type }]) => ({
      target,
      type
    }));
  }

  /**
   * 获取已注册事件列表
   */
  getEvents(): string[] {
    return Array.from(this.eventHandlers.keys());
  }

  /**
   * 清空所有路由和事件处理器
   */
  clear(): void {
    this.routes.clear();
    this.eventHandlers.clear();
    log.info('[UnifiedGateway] 已清空所有路由和事件处理器');
  }
}

// 单例实例
let instance: UnifiedGateway | null = null;

/**
 * 获取 UnifiedGateway 实例
 */
export function getUnifiedGateway(): UnifiedGateway {
  if (!instance) {
    instance = new UnifiedGateway();
    log.info('[UnifiedGateway] 创建实例');
  }
  return instance;
}
