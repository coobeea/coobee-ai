/**
 * Gateway 核心编排
 *
 * 主进程与外部世界之间的唯一桥梁，负责：
 * 1. 管理 GatewayServer（WS + HTTP 网络层）
 * 2. 自动发现并注册方法组（src/main/gateway/methods/*.ts）
 * 3. 自动发现并初始化事件桥接（src/main/gateway/events/*.ts）
 * 4. 路由客户端 RPC 请求到对应方法
 * 5. 提供事件广播 API 供方法组和事件桥接调用
 *
 * 设计对齐 WsHub 的发现模式（scanGatewayMethods / scanGatewayEventBridges）。
 */

import type { WebSocket } from 'ws';
import { log } from '@main/common/logger';
import { HttpServer } from '@main/common/server/httpServer';
import { scanGatewayMethods, scanGatewayEventBridges } from '@main/common/scan';
import { GatewayServer } from './GatewayServer';
import { registerAgentRoutes } from './http/agents';
import { registerThreadRoutes } from './http/threads';
import { registerAiAssistRoutes } from './http/ai-assist';
import { registerSkillRoutes } from './http/skills';
import { registerFileRoutes } from './http/files';
import { GatewayErrorCode, GatewayMethodError } from './protocol/errors';
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  GatewayOutMessage,
  GatewayApi,
  ClientMeta,
  ClientPredicate,
  MethodHandler,
  MethodGroup,
  EventBridgeInit
} from './protocol/types';

// ==================== Gateway ====================

export class Gateway implements GatewayApi {
  private server: GatewayServer | null = null;
  private methods = new Map<string, MethodHandler>();

  // ==================== 启动 ====================

  /**
   * 启动 Gateway
   *
   * 前置条件：HttpServer 必须已初始化（ReadyApiRegistrationHook 先执行）
   */
  start(): void {
    if (this.server?.isStarted) {
      log.warn('[Gateway] Already started');
      return;
    }

    const httpServer = HttpServer.getInstance();
    if (!httpServer) {
      log.error('[Gateway] HttpServer not initialized — Gateway requires HttpServer to start first');
      return;
    }

    // 创建 GatewayServer
    this.server = new GatewayServer({
      httpServer,
      onMessage: (ws, data, meta) => {
        this.handleMessage(ws, data, meta).catch((error) => {
          log.error('[Gateway] Error handling message:', error);
        });
      },
      onConnect: (_ws, meta) => {
        log.info(`[Gateway] Client connected: ${meta.connectionId}`);
      },
      onDisconnect: (_ws, meta) => {
        log.info(`[Gateway] Client disconnected: ${meta.connectionId}`);
      }
    });

    // 自动发现
    this.discoverMethods();
    this.discoverEventBridges();

    // 注册 system.methods（内置方法，返回所有已注册方法列表）
    this.registerBuiltinMethods();

    // 注册 HTTP REST 路由（在 start() 之前，确保路由被 Koa 捕获）
    this.registerHttpRoutes();

    // 启动网络层
    this.server.start();

    log.info(`[Gateway] Started with ${this.methods.size} method(s)`);
  }

  // ==================== 方法发现（类比 WsHub.discoverChannels） ====================

  private discoverMethods(): void {
    const modules = scanGatewayMethods();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (this.isMethodGroup(exportValue)) {
          this.registerMethods(exportValue as MethodGroup);
          log.debug(`[Gateway] 发现方法组: ${exportName} (来自 ${filePath})`);
        }
      }
    }

    log.info(`[Gateway] 方法发现完成: ${this.methods.size} 个方法 [${[...this.methods.keys()].join(', ')}]`);
  }

  /** 类型守卫：判断导出值是否为 MethodGroup */
  private isMethodGroup(value: unknown): value is MethodGroup {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.namespace === 'string' && typeof obj.methods === 'object' && obj.methods !== null;
  }

  /** 注册方法组 → 展开为 'namespace.action' 格式 */
  registerMethods(group: MethodGroup): void {
    group.onInit?.(this);
    for (const [action, handler] of Object.entries(group.methods)) {
      const fullName = `${group.namespace}.${action}`;
      if (this.methods.has(fullName)) {
        log.warn(`[Gateway] 方法名冲突，覆盖已有: ${fullName}`);
      }
      this.methods.set(fullName, handler);
    }
    log.info(`[Gateway] 注册方法组: ${group.namespace}`);
  }

  // ==================== 事件桥接发现 ====================

  private discoverEventBridges(): void {
    const modules = scanGatewayEventBridges();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (typeof exportValue === 'function') {
          try {
            (exportValue as EventBridgeInit)(this);
            log.debug(`[Gateway] 初始化事件桥接: ${exportName} (来自 ${filePath})`);
          } catch (error) {
            log.error(`[Gateway] 事件桥接初始化失败: ${exportName}`, error);
          }
        }
      }
    }
  }

  // ==================== 内置方法 ====================

  private registerBuiltinMethods(): void {
    // system.methods — 返回所有已注册方法名
    this.methods.set('system.methods', async () => {
      return { methods: [...this.methods.keys()] };
    });

    // system.health — 健康检查
    this.methods.set('system.health', async () => {
      return {
        status: 'ok',
        clients: this.clientCount,
        methods: this.methods.size
      };
    });
  }

  // ==================== HTTP REST 路由 ====================

  /**
   * 注册 HTTP REST 路由
   *
   * CRUD 操作走标准 HTTP，WebSocket 只用于流式输出和事件推送。
   * 必须在 server.start() 之前调用（start 会将 router 挂载到 Koa app）。
   */
  private registerHttpRoutes(): void {
    if (!this.server) return;
    const router = this.server.getRouter();
    registerAgentRoutes(router);
    registerThreadRoutes(router);
    registerAiAssistRoutes(router);
    registerSkillRoutes(router);
    registerFileRoutes(router);
    log.info('[Gateway] HTTP REST routes registered');
  }

  // ==================== 消息路由 ====================

  private async handleMessage(ws: WebSocket, data: string, meta: ClientMeta): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.sendError(ws, '', GatewayErrorCode.PARSE_ERROR);
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      this.sendError(ws, '', GatewayErrorCode.INVALID_MESSAGE);
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if (msg.type === 'req') {
      await this.handleRequest(ws, msg as unknown as GatewayRequest, meta);
    } else {
      this.sendError(
        ws,
        (msg.id as string) || '',
        GatewayErrorCode.UNKNOWN_MESSAGE_TYPE,
        `Unknown type: ${String(msg.type)}`
      );
    }
  }

  private async handleRequest(ws: WebSocket, req: GatewayRequest, meta: ClientMeta): Promise<void> {
    // 校验请求格式
    if (!req.id || !req.method) {
      this.sendError(ws, req.id || '', GatewayErrorCode.INVALID_MESSAGE, 'Missing id or method');
      return;
    }

    // 查找 handler
    const handler = this.methods.get(req.method);
    if (!handler) {
      this.sendError(ws, req.id, GatewayErrorCode.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      return;
    }

    // 执行 handler
    try {
      const result = await handler(req.params ?? {}, {
        clientId: meta.connectionId,
        ws,
        meta,
        gateway: this
      });

      const response: GatewayResponse = {
        type: 'res',
        id: req.id,
        ok: true,
        payload: result
      };
      this.server?.send(ws, response);
    } catch (error) {
      // 结构化错误处理
      if (error instanceof GatewayMethodError) {
        this.sendError(ws, req.id, error.code, error.message);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[Gateway] Method ${req.method} error:`, error);
        this.sendError(ws, req.id, GatewayErrorCode.INTERNAL_ERROR, message);
      }
    }
  }

  /** 发送错误响应 */
  private sendError(ws: WebSocket, requestId: string, code: GatewayErrorCode, message?: string): void {
    const response: GatewayResponse = {
      type: 'res',
      id: requestId,
      ok: false,
      error: {
        code,
        message: message ?? `Error ${code}`
      }
    };
    this.server?.send(ws, response);
  }

  // ==================== GatewayApi 实现（供方法组和事件桥接调用） ====================

  send(ws: WebSocket, payload: GatewayOutMessage): void {
    this.server?.send(ws, payload);
  }

  broadcastEvent(event: string, payload: unknown): void {
    if (!this.server) return;
    const msg: GatewayEvent = { type: 'event', event, payload };
    this.server.broadcast(msg);
  }

  broadcastEventIf(event: string, payload: unknown, predicate: ClientPredicate): number {
    if (!this.server) return 0;
    const msg: GatewayEvent = { type: 'event', event, payload };
    return this.server.broadcastIf(msg, predicate);
  }

  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void {
    this.server?.forEachClient(callback);
  }

  get clientCount(): number {
    return this.server?.clientCount ?? 0;
  }

  // ==================== 动态方法注册（Extension 热插拔用） ====================

  /** 受保护的核心命名空间 */
  private static readonly PROTECTED_NAMESPACES = ['chat', 'stream', 'thread', 'worker', 'hitl', 'system'];

  /**
   * 动态注册单个方法（Extension 用）
   *
   * @throws 核心命名空间（chat/stream/worker/hitl/system）不可覆盖
   */
  registerMethod(fullName: string, handler: MethodHandler): void {
    const namespace = fullName.split('.')[0];
    if (Gateway.PROTECTED_NAMESPACES.includes(namespace)) {
      throw new Error(`[Gateway] Cannot register "${fullName}": namespace "${namespace}" is protected`);
    }
    if (this.methods.has(fullName)) {
      log.warn(`[Gateway] registerMethod: overwriting existing "${fullName}"`);
    }
    this.methods.set(fullName, handler);
    log.info(`[Gateway] Dynamically registered method: ${fullName}`);
  }

  /**
   * 动态注销方法（Extension 热插拔用）
   *
   * @returns 是否存在并已移除
   */
  unregisterMethod(fullName: string): boolean {
    const existed = this.methods.delete(fullName);
    if (existed) {
      log.info(`[Gateway] Dynamically unregistered method: ${fullName}`);
    }
    return existed;
  }

  // ==================== 生命周期 ====================

  /** 关闭 Gateway */
  close(): void {
    this.server?.close();
    this.methods.clear();
    log.info('[Gateway] Closed');
  }

  /** 获取已注册方法列表（用于调试/测试） */
  getRegisteredMethods(): string[] {
    return [...this.methods.keys()];
  }
}
