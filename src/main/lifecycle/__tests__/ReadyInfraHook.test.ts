/**
 * ReadyInfraHook 单元测试
 *
 * 验证三大基础设施（ConfigStore + ProviderSystem + Pipeline）
 * 在 READY 阶段被正确初始化。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LifecyclePhase } from '@main/common/types';
import { ReadyInfraHook } from '../ReadyInfraHook';

// ─── Hoisted mocks ──────────────────────────────
const mocks = vi.hoisted(() => {
  const mockLoad = vi.fn();
  const mockEnsureConfigFile = vi.fn();
  const mockSnapshot = vi.fn();
  const mockClearCache = vi.fn();
  const mockWatcherStart = vi.fn();
  const mockWatcherOnReload = vi.fn();
  const mockWatcherStop = vi.fn();
  const mockSetConfigStoreInstance = vi.fn();
  const mockLoadFromConfig = vi.fn();
  const mockRegistryClear = vi.fn();
  const mockGetEnabled = vi.fn().mockReturnValue([]);
  const mockUpdateConfig = vi.fn();
  const mockSetProviderSystem = vi.fn();
  const mockInitPipeline = vi.fn();

  return {
    mockLoad,
    mockEnsureConfigFile,
    mockSnapshot,
    mockClearCache,
    mockWatcherStart,
    mockWatcherOnReload,
    mockWatcherStop,
    mockSetConfigStoreInstance,
    mockLoadFromConfig,
    mockRegistryClear,
    mockGetEnabled,
    mockUpdateConfig,
    mockSetProviderSystem,
    mockInitPipeline
  };
});

// ─── Module mocks ──────────────────────────────

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      configDir: '/tmp/test-config'
    }
  }
}));

vi.mock('@main/common/config/ConfigLoader', () => ({
  ConfigLoader: class MockConfigLoader {
    configPath = '/tmp/test-config/coobee.json5';
    configDir = '/tmp/test-config';
    load = mocks.mockLoad;
    ensureConfigFile = mocks.mockEnsureConfigFile;
    snapshot = mocks.mockSnapshot;
    clearCache = mocks.mockClearCache;
  }
}));

vi.mock('@main/common/config/ConfigStore', () => ({
  ConfigStore: class MockConfigStore {
    getAll = vi.fn();
    get = vi.fn();
    set = vi.fn();
    patch = vi.fn();
  },
  configStoreInstance: null,
  setConfigStoreInstance: mocks.mockSetConfigStoreInstance
}));

vi.mock('@main/common/config/ConfigWatcher', () => ({
  ConfigWatcher: class MockConfigWatcher {
    start = mocks.mockWatcherStart;
    stop = mocks.mockWatcherStop;
    onReload = mocks.mockWatcherOnReload;
    get isWatching(): boolean {
      return false;
    }
  }
}));

vi.mock('@main/ai/provider/ProviderRegistry', () => ({
  ProviderRegistry: class MockProviderRegistry {
    loadFromConfig = mocks.mockLoadFromConfig;
    clear = mocks.mockRegistryClear;
    getEnabled = mocks.mockGetEnabled;
    getAll = vi.fn().mockReturnValue([]);
    get = vi.fn();
    has = vi.fn();
    register = vi.fn();
    get size(): number {
      return 0;
    }
  }
}));

vi.mock('@main/ai/provider/ModelSelector', () => ({
  ModelSelector: class MockModelSelector {
    resolve = vi.fn();
    updateConfig = mocks.mockUpdateConfig;
    setSessionOverride = vi.fn();
    setAgentOverride = vi.fn();
  }
}));

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    setProviderSystem: mocks.mockSetProviderSystem,
    initPipeline: mocks.mockInitPipeline
  }
}));

// ─── Default config ──────────────────────────────

const defaultConfig = {
  models: {
    providers: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        api: 'openai-compatible',
        models: [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 }],
        enabled: true
      }
    }
  },
  agents: { defaults: { model: 'openai/gpt-4o' }, list: {} },
  messages: {
    queue: {
      mode: 'collect' as const,
      debounceMs: 500,
      cap: 20,
      dropPolicy: 'summarize' as const
    }
  },
  ui: { theme: 'auto', language: 'zh-CN', soundEffects: true },
  logging: { level: 'info', file: true }
};

// ─── Tests ──────────────────────────────────────

describe('ReadyInfraHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLoad.mockReturnValue(defaultConfig);
    mocks.mockGetEnabled.mockReturnValue([{ id: 'openai', name: 'openai', enabled: true }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const context = { phase: LifecyclePhase.READY, manager: {} as never, data: {} };

  // ─── 元数据 ──────────

  it('should have correct metadata', () => {
    expect(ReadyInfraHook.name).toBe('ready-infra');
    expect(ReadyInfraHook.phase).toBe(LifecyclePhase.READY);
    expect(ReadyInfraHook.priority).toBe(55);
    expect(ReadyInfraHook.critical).toBe(false);
  });

  // ─── ConfigStore 初始化 ──────────

  it('should initialize ConfigStore', async () => {
    await ReadyInfraHook.execute(context);

    expect(mocks.mockEnsureConfigFile).toHaveBeenCalled();
    expect(mocks.mockSetConfigStoreInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mockLoad).toHaveBeenCalled();
  });

  it('should start ConfigWatcher', async () => {
    await ReadyInfraHook.execute(context);

    expect(mocks.mockWatcherStart).toHaveBeenCalledTimes(1);
    expect(mocks.mockWatcherOnReload).toHaveBeenCalledTimes(1);
  });

  // ─── ProviderSystem 初始化 ──────────

  it('should initialize ProviderSystem and inject into AgentExecutor', async () => {
    await ReadyInfraHook.execute(context);

    expect(mocks.mockLoadFromConfig).toHaveBeenCalledWith(defaultConfig);
    expect(mocks.mockSetProviderSystem).toHaveBeenCalledTimes(1);

    const arg = mocks.mockSetProviderSystem.mock.calls[0][0];
    expect(arg).toHaveProperty('registry');
    expect(arg).toHaveProperty('selector');
  });

  // ─── Pipeline 初始化 ──────────

  it('should initialize MessagePipeline with queue config', async () => {
    await ReadyInfraHook.execute(context);

    expect(mocks.mockInitPipeline).toHaveBeenCalledTimes(1);
    const settings = mocks.mockInitPipeline.mock.calls[0][0];
    expect(settings).toEqual({
      mode: 'collect',
      cap: 20,
      dropPolicy: 'summarize'
    });
  });

  it('should use undefined settings when no queue config', async () => {
    mocks.mockLoad.mockReturnValue({
      ...defaultConfig,
      messages: undefined
    });

    await ReadyInfraHook.execute(context);

    expect(mocks.mockInitPipeline).toHaveBeenCalledWith(undefined);
  });

  // ─── 热重载 ──────────

  it('should register hot-reload handler that updates provider and selector', async () => {
    await ReadyInfraHook.execute(context);

    const reloadHandler = mocks.mockWatcherOnReload.mock.calls[0][0];
    expect(typeof reloadHandler).toBe('function');

    const newConfig = {
      ...defaultConfig,
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: 'sk-new',
            api: 'anthropic',
            models: [{ id: 'claude-3', name: 'Claude 3' }],
            enabled: true
          }
        }
      }
    };
    mocks.mockLoad.mockReturnValue(newConfig);

    reloadHandler({ changedPaths: ['models'], hotPaths: ['models'], nonePaths: [] });

    expect(mocks.mockRegistryClear).toHaveBeenCalled();
    expect(mocks.mockLoadFromConfig).toHaveBeenCalledWith(newConfig);
    expect(mocks.mockUpdateConfig).toHaveBeenCalledWith(newConfig);
  });

  // ─── 容错 ──────────

  it('should not throw when initialization fails', async () => {
    mocks.mockLoad.mockImplementation(() => {
      throw new Error('Config read failed');
    });

    await expect(ReadyInfraHook.execute(context)).resolves.toBeUndefined();
  });
});
