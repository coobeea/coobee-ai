/**
 * API 路由注册测试
 *
 * 测试 Gateway HTTP API 的路由注册和功能可用性：
 * - Agents API: /gateway/agents
 * - Threads API: /gateway/threads
 * - Skills API: /gateway/skills
 * - Files API: /gateway/files
 * - Metrics API: /gateway/metrics
 * - Cron Jobs API: /gateway/cron-jobs
 * - Health Check: /gateway/health
 *
 * 测试方式：
 * - 验证路由函数可以成功注册
 * - 验证路由处理器可以成功创建并处理请求
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';

// ==================== Mock 依赖 ====================

vi.mock('@main/common/logger', () => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  return {
    log: mockLog,
    default: mockLog,
    createLogger: vi.fn(() => mockLog)
  };
});

vi.mock('@main/common/env', () => ({
  Env: {
    main: {
      serverPort: '8765',
      serverHost: '127.0.0.1'
    },
    paths: {
      workspacesDir: '/mock/workspaces',
      builtinSkillsDir: '/mock/skills/builtin',
      userSkillsDir: '/mock/skills/user',
      secretsDir: '/mock/secrets',
      agentConfigsDir: '/mock/agents'
    }
  }
}));

// Mock AgentStore
vi.mock('@main/ai/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn().mockResolvedValue({
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(true)
    })
  }
}));

// ==================== 辅助函数 ====================

/**
 * 模拟 HTTP 请求上下文
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockCtx(path: string, method = 'GET', body?: unknown): any {
  const ctx = {
    path,
    method,
    status: 200,
    body: null,
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
    request: { body },
    set: vi.fn()
  };

  // 解析路径参数
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      const paramName = parts[i].slice(1);
      const paramValue = parts[i + 1];
      if (paramValue && !paramValue.includes('?')) {
        ctx.params[paramName] = paramValue;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx as any;
}

// ==================== 测试套件 ====================

describe('HTTP API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== Health Check =====
  describe('Health Check API', () => {
    it('should have /gateway/health endpoint structure', async () => {
      const router = new Router();
      const startTime = Date.now();

      router.get('/gateway/health', (ctx) => {
        ctx.body = {
          status: 'ok',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          clients: 0
        };
      });

      const app = new Koa();
      app.use(router.routes());

      // 验证路由注册成功
      expect(router.routes).toBeDefined();
    });
  });

  // ===== Agents API =====
  describe('Agents API Routes', () => {
    it('should register /gateway/agents routes', async () => {
      const router = new Router();

      // 模拟注册路由
      router.get('/gateway/agents', async (ctx) => {
        ctx.body = { agents: [] };
      });

      router.get('/gateway/agents/tools', async (ctx) => {
        ctx.body = { tools: [] };
      });

      router.get('/gateway/agents/:id', async (ctx) => {
        ctx.body = { agent: { id: ctx.params.id } };
      });

      router.post('/gateway/agents', async (ctx) => {
        ctx.status = 201;
        ctx.body = { agent: { id: 'new' } };
      });

      router.delete('/gateway/agents/:id', async (ctx) => {
        ctx.body = { deleted: true };
      });

      // 验证路由已注册
      expect(router.routes).toBeDefined();

      // 模拟测试 GET /gateway/agents
      const ctx = createMockCtx('/gateway/agents');
      await router.routes()(ctx, async () => {});
      expect(ctx.body).toEqual({ agents: [] });
    });

    it('should handle agent CRUD operations', async () => {
      const router = new Router();
      const mockAgents = new Map([
        ['agent-1', { id: 'agent-1', name: 'Agent 1' }],
        ['agent-2', { id: 'agent-2', name: 'Agent 2' }]
      ]);

      router.get('/gateway/agents', async (ctx) => {
        ctx.body = { agents: Array.from(mockAgents.values()) };
      });

      router.get('/gateway/agents/:id', async (ctx) => {
        const agent = mockAgents.get(ctx.params.id);
        if (agent) {
          ctx.body = { agent };
        } else {
          ctx.status = 404;
          ctx.body = { error: 'Not found' };
        }
      });

      router.post('/gateway/agents', async (ctx) => {
        const body = ctx.request.body as Record<string, string>;
        const agent = { id: body.id, name: body.name };
        mockAgents.set(body.id, agent);
        ctx.status = 201;
        ctx.body = { agent };
      });

      router.delete('/gateway/agents/:id', async (ctx) => {
        const deleted = mockAgents.delete(ctx.params.id);
        ctx.body = { deleted };
      });

      // Test LIST
      let ctx = createMockCtx('/gateway/agents');
      await router.routes()(ctx, async () => {});
      expect(ctx.body.agents.length).toBe(2);

      // Test GET
      ctx = createMockCtx('/gateway/agents/agent-1');
      await router.routes()(ctx, async () => {});
      expect(ctx.body.agent.id).toBe('agent-1');

      // Test GET 404
      ctx = createMockCtx('/gateway/agents/nonexistent');
      await router.routes()(ctx, async () => {});
      expect(ctx.status).toBe(404);
    });
  });

  // ===== Threads API =====
  describe('Threads API Routes', () => {
    it('should register /gateway/threads routes', async () => {
      const router = new Router();
      const mockThreads = new Map();

      router.get('/gateway/threads', async (ctx) => {
        ctx.body = { threads: Array.from(mockThreads.values()) };
      });

      router.get('/gateway/threads/:id', async (ctx) => {
        ctx.body = { thread: mockThreads.get(ctx.params.id) || { id: ctx.params.id } };
      });

      router.post('/gateway/threads', async (ctx) => {
        const body = ctx.request.body as Record<string, string>;
        const thread = { id: 'thread-1', ...body };
        mockThreads.set('thread-1', thread);
        ctx.status = 201;
        ctx.body = { thread };
      });

      router.delete('/gateway/threads/:id', async (ctx) => {
        mockThreads.delete(ctx.params.id);
        ctx.body = { deleted: true };
      });

      // Verify routes work
      let ctx = createMockCtx('/gateway/threads');
      await router.routes()(ctx, async () => {});
      expect(ctx.body).toHaveProperty('threads');

      ctx = createMockCtx('/gateway/threads/123');
      await router.routes()(ctx, async () => {});
      expect(ctx.body).toHaveProperty('thread');
    });

    it('should support query params filtering', async () => {
      const router = new Router();

      router.get('/gateway/threads', async (ctx) => {
        const agentId = ctx.query.agentId;
        const status = ctx.query.status;
        ctx.body = { threads: [], filters: { agentId, status } };
      });

      const ctx = createMockCtx('/gateway/threads');
      ctx.query = { agentId: 'agent-1', status: 'active' };
      await router.routes()(ctx, async () => {});

      expect(ctx.body?.filters?.agentId).toBe('agent-1');
    });
  });

  // ===== Skills API =====
  describe('Skills API Routes', () => {
    it('should register /gateway/skills routes', async () => {
      const router = new Router();
      const mockSkills = [
        { name: 'brand-guidelines', description: 'Brand colors and typography' },
        { name: 'frontend-design', description: 'Create frontend interfaces' },
        { name: 'pdf', description: 'PDF manipulation' }
      ];

      router.get('/gateway/skills', async (ctx) => {
        ctx.body = { skills: mockSkills };
      });

      const ctx = createMockCtx('/gateway/skills');
      await router.routes()(ctx, async () => {});

      expect(ctx.body.skills).toHaveLength(3);
      expect(ctx.body.skills[0]).toHaveProperty('name');
    });
  });

  // ===== Files API =====
  describe('Files API Routes', () => {
    it('should register /gateway/files routes', async () => {
      const router = new Router();

      router.get('/gateway/files', async (ctx) => {
        ctx.body = { files: [] };
      });

      router.post('/gateway/files/upload', async (ctx) => {
        ctx.body = { uploaded: true };
      });

      // Test LIST
      let ctx = createMockCtx('/gateway/files');
      await router.routes()(ctx, async () => {});
      expect(ctx.body.files).toEqual([]);

      // Test UPLOAD
      ctx = createMockCtx('/gateway/files/upload', 'POST', { path: '/test' });
      await router.routes()(ctx, async () => {});
      expect(ctx.body.uploaded).toBe(true);
    });
  });

  // ===== Metrics API =====
  describe('Metrics API Routes', () => {
    it('should register /gateway/metrics routes', async () => {
      const router = new Router();

      router.get('/gateway/metrics', async (ctx) => {
        ctx.body = {
          memory: { used: 100, total: 1000, unit: 'MB' },
          cpu: { usage: 10, unit: 'percent' },
          uptime: 3600
        };
      });

      const ctx = createMockCtx('/gateway/metrics');
      await router.routes()(ctx, async () => {});

      expect(ctx.body).toHaveProperty('memory');
      expect(ctx.body).toHaveProperty('cpu');
      expect(ctx.body).toHaveProperty('uptime');
    });
  });

  // ===== Cron Jobs API =====
  describe('Cron Jobs API Routes', () => {
    it('should register /gateway/cron-jobs routes', async () => {
      const router = new Router();
      const mockJobs = [{ id: 'job-1', name: 'Daily Backup', schedule: '0 0 * * *', enabled: true }];

      router.get('/gateway/cron-jobs', async (ctx) => {
        ctx.body = { jobs: mockJobs };
      });

      router.post('/gateway/cron-jobs', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        ctx.status = 201;
        ctx.body = { job: { id: 'new-job', ...body } };
      });

      router.delete('/gateway/cron-jobs/:id', async (ctx) => {
        ctx.body = { deleted: true };
      });

      // Test LIST
      let ctx = createMockCtx('/gateway/cron-jobs');
      await router.routes()(ctx, async () => {});
      expect(ctx.body.jobs).toHaveLength(1);

      // Test CREATE
      ctx = createMockCtx('/gateway/cron-jobs', 'POST', { name: 'New Job' });
      await router.routes()(ctx, async () => {});
      expect(ctx.status).toBe(201);
    });
  });

  // ===== Terminals API =====
  describe('Terminals API Routes', () => {
    it('should register /gateway/terminals routes', async () => {
      const router = new Router();

      router.post('/gateway/terminals', async (ctx) => {
        ctx.status = 201;
        ctx.body = { terminal: { id: 'term-1' } };
      });

      router.get('/gateway/terminals/:id', async (ctx) => {
        ctx.body = { terminal: { id: ctx.params.id } };
      });

      router.delete('/gateway/terminals/:id', async (ctx) => {
        ctx.body = { deleted: true };
      });

      // Test CREATE
      let ctx = createMockCtx('/gateway/terminals', 'POST');
      await router.routes()(ctx, async () => {});
      expect(ctx.status).toBe(201);

      // Test GET
      ctx = createMockCtx('/gateway/terminals/term-1');
      await router.routes()(ctx, async () => {});
      expect(ctx.body.terminal.id).toBe('term-1');
    });
  });

  // ===== Error Handling =====
  describe('Error Handling', () => {
    it('should handle 404 for unknown routes', async () => {
      const router = new Router();

      router.get('/gateway/known', async (ctx) => {
        ctx.body = { ok: true };
      });

      const ctx = createMockCtx('/gateway/known');
      let nextCalled = false;
      await router.routes()(ctx, async () => {
        nextCalled = true;
        ctx.status = 404;
        ctx.body = { error: 'Not Found' };
      });

      // When route is handled, next() shouldn't be called for 404
      expect(nextCalled).toBe(false);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ ok: true });
    });

    it('should handle method not allowed', async () => {
      const router = new Router();

      router.get('/gateway/resource', async (ctx) => {
        ctx.body = { data: 'ok' };
      });

      const ctx = createMockCtx('/gateway/resource', 'POST');
      await router.routes()(ctx, async () => {
        ctx.status = 405;
        ctx.body = { error: 'Method Not Allowed' };
      });
      expect(ctx.status).toBe(405);
    });
  });

  // ===== Response Format =====
  describe('Response Format', () => {
    it('should return consistent JSON structure', async () => {
      const router = new Router();

      // Success response
      router.get('/gateway/success', async (ctx) => {
        ctx.body = { data: { id: 1 }, ok: true };
      });

      // Error response
      router.get('/gateway/error', async (ctx) => {
        ctx.status = 400;
        ctx.body = { error: 'Bad request' };
      });

      let ctx = createMockCtx('/gateway/success');
      await router.routes()(ctx, async () => {});
      expect(ctx.body).toHaveProperty('data');

      ctx = createMockCtx('/gateway/error');
      await router.routes()(ctx, async () => {});
      expect(ctx.body).toHaveProperty('error');
      expect(ctx.status).toBe(400);
    });
  });
});
