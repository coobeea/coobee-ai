/**
 * server/index.ts (initializeServerModules) 单元测试
 *
 * 测试目标：服务器模块初始化逻辑
 * - IPC 服务器始终创建
 * - HTTP 服务器根据环境变量决定是否创建
 * - 异常情况下不会崩溃
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 依赖（使用 vi.hoisted 解决提升问题） ====================

const { mockLog, mockEnv, mockIpcServerConstructor, mockHttpServerConstructor } = vi.hoisted(
  () => ({
    mockLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn()
    },
    mockEnv: {
      main: {
        enableHttpServer: 'false' as string | undefined,
        httpPort: '3100'
      },
      paths: {},
      isDev: true
    },
    mockIpcServerConstructor: vi.fn(),
    mockHttpServerConstructor: vi.fn()
  })
)

vi.mock('@main/common/logger', () => ({
  log: mockLog
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeListener: vi.fn()
  },
  BrowserWindow: vi.fn(),
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    getName: () => 'test',
    getVersion: () => '0.0.0',
    getLocale: () => 'zh-CN',
    isPackaged: false
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('electron-log', () => {
  const noop = (): void => {}
  return {
    default: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      transports: {
        file: { resolvePathFn: null, level: 'info', maxSize: 0, format: '' },
        console: { level: 'info', format: '' }
      },
      create: () => ({
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        verbose: noop,
        transports: {
          file: { resolvePathFn: null, level: 'info', maxSize: 0, format: '' },
          console: { level: 'info', format: '' }
        }
      })
    }
  }
})

vi.mock('@main/common/env', () => ({
  Env: mockEnv,
  default: mockEnv
}))

vi.mock('mkdirp', () => ({
  mkdirp: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../ipcServer', () => ({
  IpcServer: mockIpcServerConstructor
}))

vi.mock('../httpServer', () => ({
  HttpServer: mockHttpServerConstructor
}))

// Mock loader 防止真实模块扫描
vi.mock('../loader', () => ({
  discoverApiModules: vi.fn().mockReturnValue([])
}))

import { initializeServerModules } from '../index'

// ==================== 测试 ====================

describe('initializeServerModules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.main.enableHttpServer = 'false'
  })

  it('总是创建 IpcServer', () => {
    initializeServerModules()

    expect(mockIpcServerConstructor).toHaveBeenCalledTimes(1)
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('[ServerCore] IpcServer instance created')
    )
  })

  it('HTTP Server 禁用时不创建 HttpServer', () => {
    mockEnv.main.enableHttpServer = 'false'

    initializeServerModules()

    expect(mockHttpServerConstructor).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('HTTP Server is disabled'))
  })

  it('VITE_ENABLE_HTTP_SERVER=true 时创建 HttpServer', () => {
    mockEnv.main.enableHttpServer = 'true'

    initializeServerModules()

    expect(mockHttpServerConstructor).toHaveBeenCalledTimes(1)
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('[ServerCore] HttpServer instance created')
    )
  })

  it('VITE_ENABLE_HTTP_SERVER=TRUE（大写）时也创建 HttpServer', () => {
    mockEnv.main.enableHttpServer = 'TRUE'

    initializeServerModules()

    expect(mockHttpServerConstructor).toHaveBeenCalledTimes(1)
  })

  it('enableHttpServer 为 undefined 时不创建 HttpServer', () => {
    mockEnv.main.enableHttpServer = undefined as unknown as string

    initializeServerModules()

    expect(mockHttpServerConstructor).not.toHaveBeenCalled()
  })

  it('IpcServer 构造抛出异常时不崩溃，错误被记录', () => {
    mockIpcServerConstructor.mockImplementationOnce(() => {
      throw new Error('ipc init failed')
    })

    // 不应抛出
    expect(() => initializeServerModules()).not.toThrow()
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('[ServerCore] Failed to initialize'),
      expect.any(Error)
    )
  })

  it('HttpServer 构造抛出异常时不崩溃，错误被记录', () => {
    mockEnv.main.enableHttpServer = 'true'
    mockHttpServerConstructor.mockImplementationOnce(() => {
      throw new Error('http init failed')
    })

    expect(() => initializeServerModules()).not.toThrow()
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('[ServerCore] Failed to initialize'),
      expect.any(Error)
    )
  })

  it('成功初始化时输出完成日志', () => {
    initializeServerModules()

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Server modules initialized successfully')
    )
  })
})
