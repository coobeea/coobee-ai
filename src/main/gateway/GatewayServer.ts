/**
 * Gateway 网络层
 *
 * 负责 Gateway 的全部网络通信：
 *   - WS：创建 WebSocketServer，挂载到 HttpServer 的 http.Server
 *   - HTTP：创建 Gateway 专属 Router，挂载到 HttpServer 的 Koa app
 *
 * 不创建自己的 http.Server 或 Koa app，复用 HttpServer 的基础设施。
 */

import type { Server as NodeHttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import Router from '@koa/router';
import { log } from '@main/common/logger';
import type { HttpServer } from '@main/common/server/httpServer';
import type { ClientMeta, GatewayOutMessage, GatewayEvent } from './protocol';

// ==================== 类型 ====================

/** GatewayServer 消息处理回调 */
export type GatewayMessageHandler = (ws: WebSocket, data: string, meta: ClientMeta) => void | Promise<void>;

/** GatewayServer 连接事件回调 */
export type GatewayConnectionHandler = (ws: WebSocket, meta: ClientMeta) => void;

/** GatewayServer 配置 */
export interface GatewayServerOptions {
  /** HttpServer 实例 */
  httpServer: HttpServer;
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval?: number;
  /** 客户端消息处理 */
  onMessage?: GatewayMessageHandler;
  /** 客户端连接 */
  onConnect?: GatewayConnectionHandler;
  /** 客户端断开 */
  onDisconnect?: GatewayConnectionHandler;
}

// ==================== GatewayServer ====================

let connectionIdCounter = 0;

function generateConnectionId(): string {
  connectionIdCounter++;
  return `gw-${Date.now()}-${connectionIdCounter}`;
}

export class GatewayServer {
  private wss!: WebSocketServer;
  private router: Router;
  private clients = new Map<WebSocket, ClientMeta>();
  private initialized = false;
  private nodeHttpServer: NodeHttpServer;
  private heartbeatInterval: number;
  private onMessage?: GatewayMessageHandler;
  private onConnect?: GatewayConnectionHandler;
  private onDisconnect?: GatewayConnectionHandler;

  constructor(private options: GatewayServerOptions) {
    this.nodeHttpServer = options.httpServer.getHttpServer();
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.onMessage = options.onMessage;
    this.onConnect = options.onConnect;
    this.onDisconnect = options.onDisconnect;
    this.router = new Router({ prefix: '/gateway' });
  }

  // ==================== 生命周期 ====================

  /**
   * 启动 GatewayServer
   *
   * 1. 创建 WebSocketServer (noServer)，手动处理 http.Server 的 upgrade 事件
   * 2. 注册内置 HTTP 端点
   * 3. 将 Router 挂到 Koa app
   *
   * 使用 noServer 模式避免 Koa 在 request 事件中返回 404 阻断 WebSocket 握手。
   */
  start(): void {
    if (this.initialized) return;

    // WS 层：noServer 模式，手动处理 upgrade 事件
    this.wss = new WebSocketServer({ noServer: true });

    // 拦截 http.Server 的 upgrade 事件，只处理 /gateway/ws 路径
    this.nodeHttpServer.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(request.url || '', 'http://localhost');

      if (pathname === '/gateway/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      const meta: ClientMeta = {
        connectionId: generateConnectionId(),
        connectedAt: Date.now(),
        isAlive: true,
        heartbeatTimer: null,
        subscribedSessions: new Set()
      };
      this.clients.set(ws, meta);
      this.startHeartbeat(ws, meta);

      log.info(`[GatewayServer] Client connected: ${meta.connectionId} (total: ${this.clients.size})`);
      this.onConnect?.(ws, meta);

      ws.on('pong', () => {
        meta.isAlive = true;
      });

      ws.on('message', (data) => {
        try {
          this.onMessage?.(ws, data.toString(), meta);
        } catch (error) {
          log.error('[GatewayServer] Error handling message:', error);
        }
      });

      ws.on('close', () => {
        this.onDisconnect?.(ws, meta);
        this.cleanupClient(ws);
        log.info(`[GatewayServer] Client disconnected: ${meta.connectionId} (total: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        log.error(`[GatewayServer] Client error (${meta.connectionId}):`, error);
        this.onDisconnect?.(ws, meta);
        this.cleanupClient(ws);
      });
    });

    // HTTP 层：注册内置端点
    this.registerBuiltinRoutes();

    // 将 Router 挂到 Koa app
    const app = this.options.httpServer.getApp();
    app.use(this.router.routes()).use(this.router.allowedMethods());

    this.initialized = true;
    log.info('[GatewayServer] Started (WS: /gateway/ws, HTTP: /gateway/*)');
  }

  /** 关闭 GatewayServer */
  close(): void {
    for (const [ws, meta] of this.clients) {
      if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);
      ws.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.initialized = false;
    log.info('[GatewayServer] Closed');
  }

  // ==================== WS 通信 ====================

  /** 向单个客户端发送 JSON 消息 */
  send(ws: WebSocket, payload: GatewayOutMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /** 向所有客户端广播事件 */
  broadcast(payload: GatewayEvent): void {
    const msg = JSON.stringify(payload);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  /** 按条件广播事件 */
  broadcastIf(payload: GatewayEvent, predicate: (meta: ClientMeta) => boolean): number {
    const msg = JSON.stringify(payload);
    let count = 0;
    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && predicate(meta)) {
        ws.send(msg);
        count++;
      }
    }
    return count;
  }

  /** 遍历所有客户端 */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void {
    for (const [ws, meta] of this.clients) {
      callback(ws, meta);
    }
  }

  /** 获取客户端元数据 */
  getClientMeta(ws: WebSocket): ClientMeta | undefined {
    return this.clients.get(ws);
  }

  /** 连接数 */
  get clientCount(): number {
    return this.clients.size;
  }

  /** 是否已启动 */
  get isStarted(): boolean {
    return this.initialized;
  }

  /** 获取 Gateway HTTP Router（供外部注册额外路由） */
  getRouter(): Router {
    return this.router;
  }

  // ==================== 内部方法 ====================

  /** 注册内置 HTTP 端点 */
  private registerBuiltinRoutes(): void {
    const startTime = Date.now();

    // GET /gateway/health — 健康检查
    this.router.get('/health', (ctx) => {
      ctx.body = {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        clients: this.clients.size
      };
    });

    log.debug('[GatewayServer] Built-in HTTP routes registered');
  }

  /** 启动心跳检测 */
  private startHeartbeat(ws: WebSocket, meta: ClientMeta): void {
    meta.heartbeatTimer = setInterval(() => {
      if (!meta.isAlive) {
        log.info(`[GatewayServer] Heartbeat timeout: ${meta.connectionId}`);
        ws.terminate();
        this.cleanupClient(ws);
        return;
      }
      meta.isAlive = false;
      ws.ping();
    }, this.heartbeatInterval);
  }

  /** 清理客户端连接 */
  private cleanupClient(ws: WebSocket): void {
    const meta = this.clients.get(ws);
    if (meta?.heartbeatTimer) {
      clearInterval(meta.heartbeatTimer);
      meta.heartbeatTimer = null;
    }
    this.clients.delete(ws);
  }
}
