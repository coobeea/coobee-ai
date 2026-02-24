/**
 * Vitest 全局配置和 Mock
 *
 * 解决测试环境中的 Electron 依赖问题
 */

import { vi } from 'vitest';
import path from 'path';
import os from 'os';

const testHome = path.join(os.tmpdir(), 'coobee-ai-test');

// Mock env.ts（避免导入 Electron）
vi.mock('@main/common/env', () => {
  return {
    Env: {
      isDev: false,
      isProd: true,
      isTest: true,
      isWindows: process.platform === 'win32',
      isMac: process.platform === 'darwin',
      isLinux: process.platform === 'linux',
      isPackaged: false,

      main: {
        bundleId: 'ai.coobee.test',
        logLevel: 'info',
        serverPort: '8765'
      },

      app: {
        name: 'coobee-ai-test',
        version: '1.0.0',
        locale: 'zh-CN'
      },

      paths: {
        root: testHome,
        userData: path.join(testHome, 'user-data'),
        appData: path.join(testHome, 'app-data'),
        logPath: path.join(testHome, 'logs'),
        installDir: testHome,
        userHome: testHome,
        configDir: path.join(testHome, 'config'),
        secretsDir: path.join(testHome, 'secrets'),
        memoryDir: path.join(testHome, 'memory'),
        userMemoryDir: path.join(testHome, 'memory', 'user'),
        agentMemoryDir: path.join(testHome, 'memory', 'agent'),
        builtinAgentsDir: path.join(testHome, 'agents'),
        userAgentsDir: path.join(testHome, 'user-agents'),
        threadsDir: path.join(testHome, 'threads'),
        workspacesDir: path.join(testHome, 'workspaces'),
        builtinSkillsDir: path.join(testHome, 'skills'),
        userSkillsDir: path.join(testHome, 'user-skills'),
        builtinExtensionsDir: path.join(testHome, 'extensions'),
        userExtensionsDir: path.join(testHome, 'user-extensions'),
        workersDir: path.join(testHome, 'workers'),
        workerEnvsDir: path.join(testHome, 'worker-envs'),
        modelsDir: path.join(testHome, 'models'),
        home: os.homedir(),
        temp: os.tmpdir(),
        downloads: path.join(os.homedir(), 'Downloads'),
        documents: path.join(os.homedir(), 'Documents'),
        desktop: path.join(os.homedir(), 'Desktop')
      },

      isRendererProcess: () => false,
      isMainProcess: () => true,
      isForkedChildProcess: () => false,
      getResourcePath: (relativePath: string) => path.join(testHome, relativePath),
      getInstallDir: async () => testHome,
      getUpgradeDir: async () => path.join(testHome, 'upgrade'),
      getAgentWorkspaceDir: async (id: string) => path.join(testHome, 'workspaces', id),
      getSkillSearchPaths: async () => [path.join(testHome, 'skills')],
      getExtensionSearchPaths: async () => [path.join(testHome, 'extensions')],
      getAppRuntimeDir: () => path.join(testHome, 'runtime'),
      getPlatformRuntimeDir: () => {
        const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'win' : 'linux';
        return path.join(testHome, 'runtime', platform);
      }
    },
    default: null
  };
});

// Mock Electron 模块
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name: string) => {
        switch (name) {
          case 'userData':
            return path.join(testHome, 'user-data');
          case 'home':
            return os.homedir();
          case 'temp':
            return os.tmpdir();
          case 'appData':
            return path.join(testHome, 'app-data');
          case 'downloads':
            return path.join(os.homedir(), 'Downloads');
          case 'documents':
            return path.join(os.homedir(), 'Documents');
          case 'desktop':
            return path.join(os.homedir(), 'Desktop');
          case 'exe':
            return testHome;
          default:
            return testHome;
        }
      }),
      getAppPath: vi.fn(() => testHome),
      getName: vi.fn(() => 'coobee-ai-test'),
      getVersion: vi.fn(() => '1.0.0'),
      getLocale: vi.fn(() => 'zh-CN'),
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      isPackaged: false,
      quit: vi.fn(),
      exit: vi.fn()
    },
    ipcMain: {
      on: vi.fn(),
      once: vi.fn(),
      handle: vi.fn(),
      removeHandler: vi.fn()
    },
    BrowserWindow: vi.fn(() => ({
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: {
        send: vi.fn()
      },
      on: vi.fn(),
      close: vi.fn()
    })),
    session: {
      defaultSession: {
        clearCache: vi.fn(() => Promise.resolve())
      }
    }
  };
});

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false,
    prod: true,
    macos: process.platform === 'darwin',
    windows: process.platform === 'win32',
    linux: process.platform === 'linux'
  },
  electronApp: {
    setAppUserModelId: vi.fn()
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  }
}));

// Mock logger（避免日志干扰测试输出）
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));
