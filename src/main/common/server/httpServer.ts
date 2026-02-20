import http from 'node:http';
import path from 'node:path';

import { is } from '@electron-toolkit/utils';
import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import KoaStatic from 'koa-static';

import { Env } from '@main/common/env';
import { log } from '@main/common/logger';

const SERVER_PORT = Env.main.serverPort ? parseInt(Env.main.serverPort, 10) : 8765;

/**
 * HttpServer — 统一 HTTP + WebSocket 基础设施
 *
 * 只负责：
 *   1. 创建 Koa 实例 + 基础中间件（static / cors / bodyParser）
 *   2. 创建 http.Server 并开始监听
 *   3. 提供 getHttpServer() / getApp() 供 GatewayServer 挂载 WebSocket 和额外路由
 *
 * 所有业务路由和 WebSocket 协议由 Gateway 层管理。
 */
export class HttpServer {
  private static _instance: HttpServer | null = null;

  private app: Koa;
  private httpServer!: http.Server;

  constructor() {
    if (HttpServer._instance) {
      throw new Error('[HttpServer] Already initialized (singleton)');
    }

    this.app = new Koa();

    log.info('[HttpServer] Initializing...');
    this._setupMiddleware();
    this._startServer();

    HttpServer._instance = this;
  }

  static getInstance(): HttpServer | null {
    return HttpServer._instance;
  }

  /** 获取底层 http.Server（供 GatewayServer 挂载 WebSocket） */
  getHttpServer(): http.Server {
    return this.httpServer;
  }

  /** 获取 Koa 应用实例（供 GatewayServer 挂载额外路由） */
  getApp(): Koa {
    return this.app;
  }

  private _setupMiddleware(): void {
    let staticPath = path.join(__dirname, '../renderer');
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      staticPath = process.env['ELECTRON_RENDERER_URL'];
    }

    this.app.use(KoaStatic(staticPath, { index: 'index.html', maxAge: 0, gzip: true }));
    this.app.use(cors({ origin: '*' }));
    this.app.use(bodyParser());

    log.info('[HttpServer] Middleware setup complete.');
  }

  private _startServer(): void {
    this.app.on('error', (err, ctx) => {
      log.error('[HttpServer] Server error:', err, ctx);
    });

    this.httpServer = http.createServer(this.app.callback());

    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`[HttpServer] 端口 ${SERVER_PORT} 已被占用，请关闭占用该端口的程序或更改 VITE_HTTP_PORT 配置`);
      } else {
        log.error('[HttpServer] Server error:', err);
      }
    });

    this.httpServer.listen(SERVER_PORT, '127.0.0.1', () => {
      log.info(`[HttpServer] Listening on http://127.0.0.1:${SERVER_PORT} (HTTP + WebSocket)`);
    });
  }

  /** 彻底关闭服务器和底层连接 */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close((err) => {
        if (err) {
          log.error('[HttpServer] Error closing server:', err);
          reject(err);
        } else {
          log.info('[HttpServer] Server closed completely.');
          resolve();
        }
      });

      if (typeof this.httpServer.closeAllConnections === 'function') {
        this.httpServer.closeAllConnections();
      }
    });
  }
}
