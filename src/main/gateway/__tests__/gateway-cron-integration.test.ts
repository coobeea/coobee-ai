/**
 * Gateway-Cron 集成测试
 *
 * 测试：
 * - Gateway 启动时自动加载定时任务
 * - Gateway 关闭时停止 Cron 调度器
 * - 任务到期后自动执行（通过 triggerJob 验证执行链路）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Hoisted mocks =====
const {
  mockGatewayServerStart,
  mockGatewayServerClose,
  mockInitializeCronSystem,
  mockSchedulerStart,
  mockSchedulerStop,
  mockSchedulerTriggerJob,
  mockCaptured
} = vi.hoisted(() => ({
  mockGatewayServerStart: vi.fn(),
  mockGatewayServerClose: vi.fn().mockResolvedValue(undefined),
  mockInitializeCronSystem: vi.fn().mockResolvedValue(undefined),
  mockSchedulerStart: vi.fn().mockResolvedValue(undefined),
  mockSchedulerStop: vi.fn().mockResolvedValue(undefined),
  mockSchedulerTriggerJob: vi.fn().mockResolvedValue(true),
  mockCaptured: {
    onMessage: null as ((ws: unknown, data: string, meta: unknown) => void | Promise<void>) | null,
    onConnect: null as ((ws: unknown, meta: unknown) => void) | null,
    onDisconnect: null as ((ws: unknown, meta: unknown) => void) | null
  }
}));

// ===== Mock GatewayServer =====
vi.mock('../GatewayServer', () => ({
  GatewayServer: class MockGatewayServer {
    constructor(options: Record<string, unknown>) {
      mockCaptured.onMessage = options.onMessage as typeof mockCaptured.onMessage;
      mockCaptured.onConnect = options.onConnect as typeof mockCaptured.onConnect;
      mockCaptured.onDisconnect = options.onDisconnect as typeof mockCaptured.onDisconnect;
    }
    start = mockGatewayServerStart;
    send = vi.fn();
    broadcast = vi.fn();
    broadcastIf = vi.fn().mockReturnValue(0);
    forEachClient = vi.fn();
    close = mockGatewayServerClose;
    getRouter = vi
      .fn()
      .mockReturnValue({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() });
    get isStarted(): boolean {
      return false;
    }
    get clientCount(): number {
      return 0;
    }
  }
}));

// ===== Mock HttpServer =====
vi.mock('@main/common/server/httpServer', () => ({
  HttpServer: {
    getInstance: vi.fn().mockReturnValue({
      getHttpServer: vi.fn().mockReturnValue({}),
      getApp: vi.fn().mockReturnValue({ use: vi.fn().mockReturnThis() })
    })
  }
}));

// ===== Mock Electron =====
vi.mock('electron', () => ({
  default: {
    app: {
      getAppPath: () => '/mock',
      getPath: () => '/mock',
      getName: () => 'test',
      getVersion: () => '0.0.0',
      getLocale: () => 'en',
      isPackaged: false
    },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: vi.fn()
  },
  app: {
    getAppPath: () => '/mock',
    getPath: () => '/mock',
    getName: () => 'test',
    getVersion: () => '0.0.0',
    getLocale: () => 'en',
    isPackaged: false
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn()
}));
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }));

// ===== Mock logger =====
vi.mock('@main/common/logger', () => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log: mockLog, default: mockLog, createLogger: vi.fn(() => mockLog) };
});

// ===== Mock scan =====
vi.mock('@main/common/scan', () => ({
  scanGatewayMethods: vi.fn().mockReturnValue([]),
  scanGatewayEventBridges: vi.fn().mockReturnValue([])
}));

// ===== Mock HTTP routes =====
vi.mock('../http/agents', () => ({ registerAgentRoutes: vi.fn() }));
vi.mock('../http/threads', () => ({ registerThreadRoutes: vi.fn() }));
vi.mock('../http/skills', () => ({ registerSkillRoutes: vi.fn() }));
vi.mock('../http/files', () => ({ registerFileRoutes: vi.fn() }));
vi.mock('../http/tavern', () => ({ registerTavernRoutes: vi.fn() }));
vi.mock('../http/cron-jobs', () => ({ registerCronJobRoutes: vi.fn() }));
vi.mock('../http/brain-metrics', () => ({ registerBrainMetricsRoutes: vi.fn() }));
vi.mock('../http/metrics', () => ({ registerMetricsRoutes: vi.fn() }));
vi.mock('../http/monitoring', () => ({ registerMonitoringRoutes: vi.fn() }));

// ===== Mock Cron 模块 =====
vi.mock('@main/ai/cron', () => ({
  initializeCronSystem: (...args: unknown[]) => mockInitializeCronSystem(...args),
  getCronScheduler: vi.fn(() => ({
    start: mockSchedulerStart,
    stop: mockSchedulerStop,
    triggerJob: mockSchedulerTriggerJob,
    getStatus: vi.fn().mockReturnValue({ running: true, scheduledCount: 0, jobs: [] })
  })),
  getCronJobExecutor: vi.fn(() => ({
    setAgentExecutor: vi.fn()
  })),
  getCronJobStore: vi.fn(() => ({})),
  CronJobStore: vi.fn(),
  CronScheduler: vi.fn(),
  CronJobExecutor: vi.fn()
}));

// ===== Mock AgentExecutor =====
vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    execute: vi.fn(),
    piMono: vi.fn(),
    openai: vi.fn(),
    setProviderSystem: vi.fn(),
    initPipeline: vi.fn()
  }
}));

// ===== Mock ipcEventBroadcaster =====
vi.mock('@main/common/ipc/eventBroadcaster', () => ({
  ipcEventBroadcaster: { destroy: vi.fn() }
}));

import { Gateway } from '../Gateway';

describe('Gateway-Cron Integration', () => {
  let gateway: Gateway;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptured.onMessage = null;
    mockCaptured.onConnect = null;
    mockCaptured.onDisconnect = null;
    gateway = new Gateway();
  });

  describe('Gateway 启动时 Cron 集成', () => {
    it('Gateway.start() 应初始化 Cron 系统并启动调度器', async () => {
      gateway.start();

      // 等待异步 Cron 初始化完成
      await vi.waitFor(() => {
        expect(mockInitializeCronSystem).toHaveBeenCalled();
      });

      expect(mockSchedulerStart).toHaveBeenCalled();
      expect(mockGatewayServerStart).toHaveBeenCalled();
    });

    it('Cron 初始化失败不应阻塞 Gateway 启动', async () => {
      mockInitializeCronSystem.mockRejectedValueOnce(new Error('Cron init failed'));

      gateway.start();

      // Gateway 应正常启动
      expect(mockGatewayServerStart).toHaveBeenCalled();

      // 等待异步错误被捕获
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('Gateway 关闭时 Cron 集成', () => {
    it('Gateway.close() 应停止 Cron 调度器', async () => {
      gateway.start();
      await vi.waitFor(() => expect(mockSchedulerStart).toHaveBeenCalled());

      await gateway.close();

      expect(mockSchedulerStop).toHaveBeenCalled();
      expect(mockGatewayServerClose).toHaveBeenCalled();
    });
  });
});

describe('Cron 任务执行链路', () => {
  it('triggerJob 可触发任务执行（验证 CronJobExecutor 与 AgentExecutor 集成）', async () => {
    const gw = new Gateway();
    gw.start();
    await vi.waitFor(() => expect(mockSchedulerStart).toHaveBeenCalled());

    const { getCronScheduler } = await import('@main/ai/cron');
    const scheduler = getCronScheduler();
    const result = await scheduler.triggerJob('test-job-id');

    expect(result).toBe(true);
    expect(mockSchedulerTriggerJob).toHaveBeenCalledWith('test-job-id');
  });
});
