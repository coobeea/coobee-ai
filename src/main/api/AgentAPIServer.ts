/**
 * AgentAPIServer - Agent REST API 服务器
 *
 * 提供标准的 HTTP API 供外部调用
 */

import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createLogger } from '@main/common/logger';
import type { APIConfig, AgentAPIRequest, AgentAPIResponse } from './types';

const log = createLogger('agent-api-server');

export class AgentAPIServer {
  private app: Koa;
  private router: Router;
  private config: APIConfig;
  private server: ReturnType<typeof this.app.listen> | null = null;

  constructor(config: APIConfig) {
    this.config = config;
    this.app = new Koa();
    this.router = new Router();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    this.app.use(bodyParser());

    this.app.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;
      log.debug(`${ctx.method} ${ctx.url} - ${ctx.status} (${duration}ms)`);
    });

    this.app.use(async (ctx, next) => {
      const apiKey = ctx.headers['x-api-key'] as string;

      if (ctx.path.startsWith('/api/') && !this.config.apiKeys.includes(apiKey)) {
        ctx.status = 401;
        ctx.body = { error: 'Invalid API key' };
        return;
      }

      await next();
    });

    this.app.use(async (ctx, next) => {
      const origin = ctx.headers.origin as string;
      if (this.config.allowedOrigins.includes('*') || this.config.allowedOrigins.includes(origin)) {
        ctx.set('Access-Control-Allow-Origin', origin || '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        ctx.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
      }

      if (ctx.method === 'OPTIONS') {
        ctx.status = 204;
        return;
      }

      await next();
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    this.router.get('/health', (ctx) => {
      ctx.body = { status: 'ok', timestamp: Date.now() };
    });

    this.router.post('/api/v1/chat', async (ctx) => {
      const request = ctx.request.body as AgentAPIRequest;

      try {
        const response = await this.handleChatRequest(request);
        ctx.body = response;
      } catch (err) {
        log.error('[AgentAPIServer] Chat request failed:', err);
        ctx.status = 500;
        ctx.body = {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error'
        };
      }
    });

    this.router.get('/api/v1/sessions/:sessionId', async (ctx) => {
      const { sessionId } = ctx.params;

      try {
        const session = await this.getSession(sessionId);
        ctx.body = session;
      } catch (err) {
        log.error('[AgentAPIServer] Get session failed:', err);
        ctx.status = 404;
        ctx.body = { error: 'Session not found' };
      }
    });

    this.router.get('/api/v1/agents', async (ctx) => {
      try {
        const agents = await this.listAgents();
        ctx.body = { agents };
      } catch (err) {
        log.error('[AgentAPIServer] List agents failed:', err);
        ctx.status = 500;
        ctx.body = { error: 'Failed to list agents' };
      }
    });

    this.app.use(this.router.routes()).use(this.router.allowedMethods());
  }

  /**
   * 处理对话请求
   */
  private async handleChatRequest(request: AgentAPIRequest): Promise<AgentAPIResponse> {
    const startTime = Date.now();

    log.info(`[AgentAPIServer] Chat request for agent: ${request.agentId}`);

    const mockResponse: AgentAPIResponse = {
      sessionId: request.sessionId || `session-${Date.now()}`,
      content: `收到您的消息："${request.message}"。这是一个模拟响应。`,
      status: 'success',
      metadata: {
        duration: Date.now() - startTime,
        model: 'mock-model'
      }
    };

    return mockResponse;
  }

  /**
   * 获取会话
   */
  private async getSession(_sessionId: string): Promise<unknown> {
    return {
      id: _sessionId,
      agentId: 'default',
      messages: [],
      createdAt: Date.now()
    };
  }

  /**
   * 列出 Agent
   */
  private async listAgents(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: 'default', name: 'Default Agent' },
      { id: 'code-reviewer', name: 'Code Reviewer' }
    ];
  }

  /**
   * 启动服务器
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        log.info(`[AgentAPIServer] Server started on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info('[AgentAPIServer] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
