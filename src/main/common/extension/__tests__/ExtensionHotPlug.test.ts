/**
 * Extension 热插拔测试
 *
 * 验证 ToolRegistry.unregister 和 Gateway 动态方法注册/注销
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ToolCategory } from '../../../ai/tools/types'
import type { ToolDefinition } from '../../../ai/tools/types'
import { z } from 'zod'

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// ===== Mock Electron and heavy deps =====
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
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('@main/common/server/httpServer', () => ({
  HttpServer: { getInstance: () => null }
}))
vi.mock('@main/common/scan', () => ({
  scanGatewayMethods: () => [],
  scanGatewayEventBridges: () => []
}))

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Test tool ${name}`,
    category: ToolCategory.Extension,
    parameters: z.object({ input: z.string() }),
    // eslint-disable-next-line require-yield
    execute: async function* () {
      return { success: true, llmContent: 'ok' }
    }
  }
}

describe('ToolRegistry.unregister', () => {
  // 每次测试重置单例
  let ToolRegistry: typeof import('../../../ai/tools/registry').ToolRegistry

  beforeEach(async () => {
    // 强制重新加载模块以重置单例
    vi.resetModules()
    const mod = await import('../../../ai/tools/registry')
    ToolRegistry = mod.ToolRegistry
  })

  it('unregister — 移除后 get 返回 undefined', () => {
    const reg = ToolRegistry.getInstance()
    reg.register(makeTool('tool-a'))
    expect(reg.get('tool-a')).toBeDefined()

    const result = reg.unregister('tool-a')
    expect(result).toBe(true)
    expect(reg.get('tool-a')).toBeUndefined()
  })

  it('unregister 不存在 — 返回 false', () => {
    const reg = ToolRegistry.getInstance()
    expect(reg.unregister('nonexistent')).toBe(false)
  })
})

describe('Gateway 动态方法', () => {
  // Gateway 依赖 HttpServer, ws 等，直接测试类方法
  let Gateway: typeof import('../../../gateway/Gateway').Gateway

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../../gateway/Gateway')
    Gateway = mod.Gateway
  })

  it('registerMethod — 注册后可在 getRegisteredMethods 中找到', () => {
    const gw = new Gateway()
    const handler = async (): Promise<Record<string, unknown>> => ({ pong: true })

    gw.registerMethod('custom.ping', handler)

    expect(gw.getRegisteredMethods()).toContain('custom.ping')
  })

  it('unregisterMethod — 移除后不再存在', () => {
    const gw = new Gateway()
    gw.registerMethod('custom.foo', async () => ({}))
    expect(gw.getRegisteredMethods()).toContain('custom.foo')

    const result = gw.unregisterMethod('custom.foo')
    expect(result).toBe(true)
    expect(gw.getRegisteredMethods()).not.toContain('custom.foo')
  })

  it('Gateway 核心方法保护 — chat.* 等不可注册', () => {
    const gw = new Gateway()
    const handler = async (): Promise<Record<string, unknown>> => ({})

    expect(() => gw.registerMethod('chat.send', handler)).toThrow('namespace "chat" is protected')
    expect(() => gw.registerMethod('stream.subscribe', handler)).toThrow(
      'namespace "stream" is protected'
    )
    expect(() => gw.registerMethod('worker.start', handler)).toThrow(
      'namespace "worker" is protected'
    )
    expect(() => gw.registerMethod('hitl.decide', handler)).toThrow('namespace "hitl" is protected')
    expect(() => gw.registerMethod('system.methods', handler)).toThrow(
      'namespace "system" is protected'
    )
  })

  it('热插拔完整流程 — load → 注册生效 → unload → 注册移除', () => {
    const gw = new Gateway()

    // 模拟 Extension load：注册一个自定义方法
    gw.registerMethod('ext.hello', async () => ({ message: 'world' }))
    expect(gw.getRegisteredMethods()).toContain('ext.hello')

    // 模拟 Extension unload：移除方法
    const removed = gw.unregisterMethod('ext.hello')
    expect(removed).toBe(true)
    expect(gw.getRegisteredMethods()).not.toContain('ext.hello')
  })

  it('unregisterMethod 不存在的方法 — 返回 false', () => {
    const gw = new Gateway()
    expect(gw.unregisterMethod('nonexistent.method')).toBe(false)
  })

  it('registerMethod 覆盖已有方法 — 不抛错，覆盖', () => {
    const gw = new Gateway()
    gw.registerMethod('ext.foo', async () => ({ v: 1 }))
    // 再次注册同名方法 — 覆盖
    expect(() => gw.registerMethod('ext.foo', async () => ({ v: 2 }))).not.toThrow()
    expect(gw.getRegisteredMethods()).toContain('ext.foo')
  })

  it('多个动态方法注册和按需卸载', () => {
    const gw = new Gateway()
    gw.registerMethod('ext.a', async () => ({}))
    gw.registerMethod('ext.b', async () => ({}))
    gw.registerMethod('ext.c', async () => ({}))

    expect(gw.getRegisteredMethods()).toContain('ext.a')
    expect(gw.getRegisteredMethods()).toContain('ext.b')
    expect(gw.getRegisteredMethods()).toContain('ext.c')

    gw.unregisterMethod('ext.b')
    expect(gw.getRegisteredMethods()).not.toContain('ext.b')
    expect(gw.getRegisteredMethods()).toContain('ext.a')
    expect(gw.getRegisteredMethods()).toContain('ext.c')
  })
})

describe('ToolRegistry — 补充维度', () => {
  let ToolRegistry: typeof import('../../../ai/tools/registry').ToolRegistry

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../../ai/tools/registry')
    ToolRegistry = mod.ToolRegistry
  })

  it('unregister 后 getAll 不包含已移除工具', () => {
    const reg = ToolRegistry.getInstance()
    reg.register(makeTool('tool-x'))
    reg.register(makeTool('tool-y'))
    expect(reg.getAll()).toHaveLength(2)

    reg.unregister('tool-x')
    const all = reg.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('tool-y')
  })

  it('unregister 后可重新注册同名工具', () => {
    const reg = ToolRegistry.getInstance()
    reg.register(makeTool('tool-z'))
    reg.unregister('tool-z')

    // 重新注册不应报错
    expect(() => reg.register(makeTool('tool-z'))).not.toThrow()
    expect(reg.get('tool-z')).toBeDefined()
  })

  it('register 重复名称 — 抛错', () => {
    const reg = ToolRegistry.getInstance()
    reg.register(makeTool('dup'))
    expect(() => reg.register(makeTool('dup'))).toThrow('Tool dup already registered')
  })

  it('registerAll — 批量注册', () => {
    const reg = ToolRegistry.getInstance()
    reg.registerAll([makeTool('batch-1'), makeTool('batch-2'), makeTool('batch-3')])
    expect(reg.getAll()).toHaveLength(3)
  })

  it('get 不存在的工具 — 返回 undefined', () => {
    const reg = ToolRegistry.getInstance()
    expect(reg.get('no-such-tool')).toBeUndefined()
  })

  it('singleton — 多次 getInstance 返回同一实例', () => {
    const a = ToolRegistry.getInstance()
    const b = ToolRegistry.getInstance()
    expect(a).toBe(b)
  })
})
