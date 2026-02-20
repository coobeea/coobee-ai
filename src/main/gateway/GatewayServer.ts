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
   * 1. 创建 WebSocketServer，挂到 http.Server（通过 path 隔离）
   * 2. 注册内置 HTTP 端点
   * 3. 将 Router 挂到 Koa app
   */
  start(): void {
    if (this.initialized) return;

    // WS 层：挂载到 http.Server，使用 /gateway/ws 路径
    this.wss = new WebSocketServer({
      server: this.nodeHttpServer,
      path: '/gateway/ws'
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
  close(): Promise<void> {
    return new Promise((resolve) => {
      // 停止心跳并关闭所有 WebSocket 客户端
      for (const [ws, meta] of this.clients) {
        if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);
        ws.terminate(); // 使用 terminate 强制断开而不是 close()
      }
      this.clients.clear();

      if (this.wss) {
        // 关闭 WebSocketServer
        this.wss.close(() => {
          this.initialized = false;
          log.info('[GatewayServer] Closed');
          resolve();
        });
      } else {
        this.initialized = false;
        log.info('[GatewayServer] Closed (no WSS)');
        resolve();
      }
    });
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
