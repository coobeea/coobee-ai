/**
 * config_get 工具测试
 *
 * 覆盖：
 *   - 获取全部配置
 *   - 获取指定配置节
 *   - 无效配置节拒绝
 *   - ConfigStore 不可用的降级
 *   - API Key 脱敏
 *   - 工具元数据
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

// ===== Mock Electron =====
vi.mock('electron', () => {
  const base = join(process.cwd(), 'test-results');
  return {
    app: {
      getPath: (name: string) => join(base, name),
      getAppPath: () => base,
      getName: () => 'coobee-test',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  };
});

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }));

vi.mock('electron-log', () => {
  const noop = (): void => {};
  const mockTransport = {
    resolvePathFn: null,
    level: 'info',
    maxSize: 10 * 1024 * 1024,
    format: '',
    getFile: () => ({ path: '/tmp/test.log' })
  };
  const mockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    transports: {
      file: { ...mockTransport },
      console: { level: 'info', format: '' }
    },
    create: () => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      transports: {
        file: { ...mockTransport },
        console: { level: 'info', format: '' }
      }
    })
  };
  return { default: mockLogger };
});

// ===== Mock ConfigStore =====

const mockFullConfig = {
  security: {
    sandbox: { mode: 'path-only' },
    approvals: { exec: 'auto' }
  },
  models: {
    providers: {
      dashscope: {
        name: 'DashScope',
        baseUrl: 'https://dashscope.aliyuncs.com',
        apiKey: 'sk-real-key-12345',
        models: []
      }
    },
    defaults: {
      model: { primary: 'dashscope/qwen3.5-plus' },
      thinkingLevel: 'medium'
    }
  },
  ui: {
    theme: 'auto',
    language: 'zh-CN',
    soundEffects: true
  },
  logging: {
    level: 'info',
    file: true
  }
};

let mockConfigStoreInstance: {
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock('@main/common/config/ConfigStore', () => ({
  get configStoreInstance() {
    return mockConfigStoreInstance;
  }
}));

// ===== Import =====

import { configGetTool } from '../config_get';
import type { ToolResult, ToolStreamUpdate } from '../../types';

// ===== Helper =====

async function executeTool(
  params: Record<string, unknown>
): Promise<{ result: ToolResult; updates: ToolStreamUpdate[] }> {
  const updates: ToolStreamUpdate[] = [];
  const gen = configGetTool.execute(params);
  let step = await gen.next();
  while (!step.done) {
    updates.push(step.value as ToolStreamUpdate);
    step = await gen.next();
  }
  return { result: step.value as ToolResult, updates };
}

// ===== Tests =====

describe('config_get 工具', () => {
  beforeEach(() => {
    mockConfigStoreInstance = {
      get: vi.fn((key: string) => {
        return (mockFullConfig as Record<string, unknown>)[key];
      }),
      getAll: vi.fn().mockReturnValue(mockFullConfig)
    };
  });

  afterEach(() => {
    mockConfigStoreInstance = null;
    vi.restoreAllMocks();
  });

  // --- 基本功能 ---

  describe('获取配置', () => {
    it('获取全部配置', async () => {
      const { result } = await executeTool({});

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('config (all sections)');
      expect(result.llmContent).toContain('security');
      expect(result.llmContent).toContain('defaults');
      expect(result.llmContent).toContain('path-only');
      expect(mockConfigStoreInstance!.getAll).toHaveBeenCalled();
    });

    it('获取指定配置节 — security', async () => {
      const { result } = await executeTool({ key: 'security' });

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('config.security');
      expect(result.llmContent).toContain('path-only');
      expect(result.llmContent).toContain('auto');
      expect(mockConfigStoreInstance!.get).toHaveBeenCalledWith('security');
    });

    it('获取指定配置节 — models（包含 defaults）', async () => {
      const { result } = await executeTool({ key: 'models' });

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('config.models');
      expect(result.llmContent).toContain('qwen3.5-plus');
      expect(result.llmContent).toContain('medium');
    });
  });

  // --- API Key 脱敏 ---

  describe('API Key 脱敏', () => {
    it('全量配置中 API Key 被脱敏', async () => {
      const { result } = await executeTool({});

      expect(result.success).toBe(true);
      expect(result.llmContent).not.toContain('sk-real-key-12345');
      expect(result.llmContent).toContain('****');
    });

    it('models 节中 API Key 被脱敏', async () => {
      const { result } = await executeTool({ key: 'models' });

      expect(result.success).toBe(true);
      expect(result.llmContent).not.toContain('sk-real-key-12345');
      expect(result.llmContent).toContain('****');
    });
  });

  // --- 错误处理 ---

  describe('错误处理', () => {
    it('无效配置节返回错误', async () => {
      const { result } = await executeTool({ key: 'invalid_key' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_KEY');
      expect(result.llmContent).toContain('Unknown config key');
      expect(result.llmContent).toContain('Valid keys');
    });

    it('ConfigStore 未初始化时返回错误', async () => {
      mockConfigStoreInstance = null;

      const { result } = await executeTool({});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_INITIALIZED');
    });
  });

  // --- 工具元数据 ---

  describe('工具定义元数据', () => {
    it('不需要用户确认（只读）', () => {
      expect(configGetTool.needUserConfirm).toBe(false);
    });

    it('名称正确', () => {
      expect(configGetTool.name).toBe('config_get');
    });

    it('类别为 Configuration', () => {
      expect(configGetTool.category).toBe('configuration');
    });
  });
});
