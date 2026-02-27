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
const SERVER_HOST = Env.main.serverHost;

/**
 * HttpServer — 统一 HTTP + WebSocket 基础设施
 *
 * 只负责：
 *   1. 创建 Koa 实例 + 基础中间件（static / cors / bodyParser）
 *   2. 创建 http.Server 并开始监听
 *   3. 提供 getHttpServer() / getApp() 供 GatewayServer 挂载 WebSocket 和额外路由
 *
 * 通过 VITE_SERVER_HOST 控制绑定地址：
 *   - 默认 127.0.0.1（仅本机访问）
 *   - 设为 0.0.0.0 可开启局域网 Web 访问
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
    this.app.use(cors({ origin: '*' }));
    this.app.use(bodyParser());

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      // 开发模式：反向代理到 Vite dev server，让外部浏览器也能通过统一端口访问前端
      const viteUrl = new URL(process.env['ELECTRON_RENDERER_URL']);
      this.app.use(this._createDevProxy(viteUrl.hostname, parseInt(viteUrl.port, 10)));
      log.info(`[HttpServer] Dev proxy → ${process.env['ELECTRON_RENDERER_URL']}`);
    } else {
      // 生产模式：直接服务构建产物
      const staticPath = path.join(__dirname, '../renderer');
      this.app.use(KoaStatic(staticPath, { index: 'index.html', maxAge: 0, gzip: true }));
      log.info(`[HttpServer] Static files → ${staticPath}`);
    }

    log.info('[HttpServer] Middleware setup complete.');
  }

  /**
   * 轻量反向代理中间件（开发模式专用）
   * 将未匹配 API/WebSocket 的请求转发到 Vite dev server
   */
  private _createDevProxy(host: string, port: number): Koa.Middleware {
    return async (ctx, next) => {
      // 已被其他中间件/路由处理的请求跳过
      if (ctx.respond === false || ctx.body != null) {
        await next();
        return;
      }

      // Gateway/API 路由不代理
      const p = ctx.path;
      if (p.startsWith('/gateway/') || p.startsWith('/api/')) {
        await next();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const proxyReq = http.request(
          {
            hostname: host,
            port,
            path: ctx.url,
            method: ctx.method,
            headers: { ...ctx.headers, host: `${host}:${port}` }
          },
          (proxyRes) => {
            ctx.status = proxyRes.statusCode || 502;
            const resHeaders = proxyRes.headers;
            for (const [key, val] of Object.entries(resHeaders)) {
              if (val != null) ctx.set(key, val as string);
            }
            ctx.body = proxyRes;
            resolve();
          }
        );
        proxyReq.on('error', (err) => {
          log.debug(`[HttpServer] Dev proxy error: ${err.message}`);
          reject(err);
        });
        if (ctx.req.readable) {
          ctx.req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
      }).catch(async () => {
        await next();
      });
    };
  }

  private _startServer(): void {
    this.app.on('error', (err, ctx) => {
      log.error('[HttpServer] Server error:', err, ctx);
    });

    this.httpServer = http.createServer(this.app.callback());

    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`[HttpServer] 端口 ${SERVER_PORT} 已被占用，请关闭占用该端口的程序或更改 VITE_SERVER_PORT 配置`);
      } else {
        log.error('[HttpServer] Server error:', err);
      }
    });

    this.httpServer.listen(SERVER_PORT, SERVER_HOST, () => {
      log.info(`[HttpServer] Listening on http://${SERVER_HOST}:${SERVER_PORT} (HTTP + WebSocket)`);
      if (SERVER_HOST === '0.0.0.0') {
        log.info('[HttpServer] 局域网 Web 访问已开启，外部浏览器可通过本机 IP 访问');
      }
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
