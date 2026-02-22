import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dummyExtension, { getDummyState, resetDummyState } from './index';
import type { MethodContext } from '@main/gateway/protocol/types';

// Mock Gateway internals and Electron BEFORE importing local modules
vi.mock('electron', () => ({
  default: {
    app: {
      getAppPath: () => '/tmp',
      getPath: () => '/tmp',
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
    getAppPath: () => '/tmp',
    getPath: () => '/tmp',
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
vi.mock('@main/common/logger', () => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    log: mockLog,
    default: mockLog,
    createLogger: vi.fn(() => mockLog)
  };
});

// Now import local modules
import { ExtensionRegistry } from '../../ExtensionRegistry';
import { createExtensionApi } from '../../ExtensionApi';
import { ChannelManager } from '../../../../channels/ChannelManager';
import { Gateway } from '../../../../gateway/Gateway';
import type { MethodHandler } from '../../../../gateway/protocol/types';

vi.mock('@main/gateway/GatewayServer', () => {
  return {
    GatewayServer: class {
      isStarted = false;
      router = {
        get: vi.fn((path: string, handler: unknown) => {
          this.routes[path] = handler;
        })
      };
      routes: Record<string, unknown> = {};

      start(): void {
        this.isStarted = true;
      }
      close(): void {
        this.isStarted = false;
      }
      getRouter(): typeof this.router {
        return this.router;
      }
    }
  };
});
vi.mock('@main/common/server/httpServer', () => ({
  HttpServer: { getInstance: () => ({}) }
}));
vi.mock('@main/common/scan', () => ({
  scanGatewayMethods: () => [],
  scanGatewayEventBridges: () => []
}));

describe('Extension Integration (E2E)', () => {
  let registry: ExtensionRegistry;
  let channelManager: ChannelManager;
  let gateway: Gateway;

  beforeEach(() => {
    registry = new ExtensionRegistry();
    channelManager = ChannelManager.getInstance();
    channelManager.clear();
    gateway = new Gateway();
    resetDummyState();

    // Set up global registry for Gateway to use
    vi.doMock('@main/common/extension', () => ({
      ExtensionManager: {
        getRegistry: () => registry
      }
    }));
  });

  afterEach(async () => {
    await channelManager.stopAll();
    await gateway.close();
    vi.resetModules();
  });

  it('should successfully register and execute all extension components', async () => {
    // 1. Register Extension
    const api = createExtensionApi(dummyExtension.id, dummyExtension.name, 'builtin', registry);
    await dummyExtension.register(api);

    // Verify registrations
    expect(registry.getServices()).toHaveLength(1);
    expect(registry.getChannels()).toHaveLength(1);
    expect(registry.getHttpRoutes()).toHaveLength(1);
    expect(registry.getGatewayMethods()).toHaveLength(1);

    // 2. Start Services (simulating ReadyExtensionHook)
    for (const { service } of registry.getServices()) {
      await service.start();
    }
    expect(getDummyState().serviceStarted).toBe(true);

    // 3. Start Channels (simulating ReadyExtensionHook)
    for (const { channel } of registry.getChannels()) {
      channelManager.registerChannel(channel);
    }
    await channelManager.startAll();
    expect(getDummyState().channelStarted).toBe(true);
    expect(getDummyState().channelSignalAborted).toBe(false);

    // 4. Start Gateway (simulating Gateway startup and HTTP route mounting)
    // Manually register the method to gateway since ExtensionHotPlug usually handles it,
    // or Gateway start() will discover it if we used ExtensionManager.
    const methods = registry.getGatewayMethods();
    for (const { method, handler } of methods) {
      gateway.registerMethod(method, handler);
    }

    // Test the registered RPC method
    const rpcHandler = gateway['methods'].get('dummy.ping') as MethodHandler;
    expect(rpcHandler).toBeDefined();
    const rpcResult = await rpcHandler({}, {} as unknown as MethodContext);
    expect(rpcResult).toEqual({ pong: true });

    // Test the HTTP route (simulating Koa context)
    // We need to trigger the private mountExtensionHttpRoutes method
    const routerMock = {
      get: vi.fn((path: string, handler: (ctx: { status?: number; body?: unknown }) => void) => {
        if (path === '/dummy-route') {
          const ctx: { status?: number; body?: unknown } = {};
          handler(ctx);
          expect(ctx.status).toBe(200);
          expect(ctx.body).toEqual({ success: true });
        }
      })
    };
    await (
      gateway as unknown as { mountExtensionHttpRoutes: (router: typeof routerMock) => Promise<void> }
    ).mountExtensionHttpRoutes(routerMock);
    expect(routerMock.get).toHaveBeenCalledWith('/dummy-route', expect.any(Function));
    expect(getDummyState().httpCalled).toBe(true);

    // 5. Stop everything (simulating BeforeQuitExtensionHook)
    await channelManager.stopAll();
    expect(getDummyState().channelStarted).toBe(false);
    expect(getDummyState().channelSignalAborted).toBe(true); // Abort signal should be triggered

    for (const { service } of registry.getServices()) {
      await service.stop();
    }
    expect(getDummyState().serviceStarted).toBe(false);
  });
});
