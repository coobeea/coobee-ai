/**
 * ExtensionApi 工厂单元测试
 *
 * 验证 createExtensionApi 创建的 api 对象：
 *   - 属性正确性（id, name, origin, logger）
 *   - registerTool 代理到 registry
 *   - on() 代理到 registry.registerHook（含默认/自定义优先级）
 *   - registerGatewayMethod 代理到 registry
 *   - logger 各方法可调用
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ExtensionRegistry } from '../ExtensionRegistry'
import { createExtensionApi } from '../ExtensionApi'
import { ToolCategory } from '../../../ai/tools/types'
import type { ToolDefinition } from '../../../ai/tools/types'
import type { ExtensionApi } from '../types'
import { z } from 'zod'

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

describe('createExtensionApi', () => {
  let registry: ExtensionRegistry
  let api: ExtensionApi

  beforeEach(() => {
    registry = new ExtensionRegistry()
    api = createExtensionApi('ext-test', 'Test Extension', 'user', registry)
  })

  // ---- 属性 ----

  it('返回正确的 id', () => {
    expect(api.id).toBe('ext-test')
  })

  it('返回正确的 name', () => {
    expect(api.name).toBe('Test Extension')
  })

  it('返回正确的 origin', () => {
    expect(api.origin).toBe('user')
  })

  it('不同 origin 值 — builtin', () => {
    const builtinApi = createExtensionApi('ext-bi', 'Builtin', 'builtin', registry)
    expect(builtinApi.origin).toBe('builtin')
  })

  it('不同 origin 值 — workspace', () => {
    const wsApi = createExtensionApi('ext-ws', 'Workspace', 'workspace', registry)
    expect(wsApi.origin).toBe('workspace')
  })

  // ---- logger ----

  it('logger.info 可正常调用', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    api.logger.info('test message', 'extra')
    expect(spy).toHaveBeenCalledWith('[Extension:ext-test]', 'test message', 'extra')
    spy.mockRestore()
  })

  it('logger.warn 可正常调用', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.logger.warn('warning')
    expect(spy).toHaveBeenCalledWith('[Extension:ext-test]', 'warning')
    spy.mockRestore()
  })

  it('logger.error 可正常调用', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.logger.error('error')
    expect(spy).toHaveBeenCalledWith('[Extension:ext-test]', 'error')
    spy.mockRestore()
  })

  it('logger.debug 可正常调用', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    api.logger.debug('debug info')
    expect(spy).toHaveBeenCalledWith('[Extension:ext-test]', 'debug info')
    spy.mockRestore()
  })

  // ---- registerTool ----

  it('registerTool — 正确代理到 registry', () => {
    const tool = makeTool('my-tool')
    api.registerTool(tool)

    const tools = registry.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].extensionId).toBe('ext-test')
    expect(tools[0].tool.name).toBe('my-tool')
  })

  it('registerTool — 重复工具名抛错', () => {
    api.registerTool(makeTool('dup'))
    expect(() => api.registerTool(makeTool('dup'))).toThrow('Tool "dup" already registered')
  })

  it('registerTool — 多个工具全部注册', () => {
    api.registerTool(makeTool('t1'))
    api.registerTool(makeTool('t2'))
    api.registerTool(makeTool('t3'))

    expect(registry.getTools()).toHaveLength(3)
  })

  // ---- on (registerHook) ----

  it('on() — 注册 hook 并绑定正确的 extensionId', () => {
    api.on('session_start', async () => {})

    const hooks = registry.getHooks('session_start')
    expect(hooks).toHaveLength(1)
    expect(hooks[0].extensionId).toBe('ext-test')
    expect(hooks[0].hookName).toBe('session_start')
  })

  it('on() — 默认 priority 为 0', () => {
    api.on('session_start', async () => {})

    const hooks = registry.getHooks('session_start')
    expect(hooks[0].priority).toBe(0)
  })

  it('on() — 自定义 priority', () => {
    api.on('session_start', async () => {}, { priority: 99 })

    const hooks = registry.getHooks('session_start')
    expect(hooks[0].priority).toBe(99)
  })

  it('on() — 注册 modifying hook 并可返回结果', async () => {
    api.on('before_agent_start', async () => ({ prependContext: 'hello' }))

    const hooks = registry.getHooks('before_agent_start')
    expect(hooks).toHaveLength(1)

    const result = await hooks[0].handler({ sessionId: 's1', prompt: 'test' })
    expect(result).toEqual({ prependContext: 'hello' })
  })

  it('on() — 注册多种不同 hookName', () => {
    api.on('session_start', async () => {})
    api.on('session_end', async () => {})
    api.on('before_agent_start', async () => ({}))
    api.on('agent_end', async () => {})

    expect(registry.getHooks('session_start')).toHaveLength(1)
    expect(registry.getHooks('session_end')).toHaveLength(1)
    expect(registry.getHooks('before_agent_start')).toHaveLength(1)
    expect(registry.getHooks('agent_end')).toHaveLength(1)
  })

  it('on() — 同一 hookName 注册多次', () => {
    api.on('session_start', async () => {}, { priority: 10 })
    api.on('session_start', async () => {}, { priority: 20 })

    const hooks = registry.getHooks('session_start')
    expect(hooks).toHaveLength(2)
    // 按优先级排序
    expect(hooks[0].priority).toBe(20)
    expect(hooks[1].priority).toBe(10)
  })

  // ---- registerGatewayMethod ----

  it('registerGatewayMethod — 正确代理到 registry', () => {
    const handler = async (): Promise<Record<string, unknown>> => ({ ok: true })
    api.registerGatewayMethod('custom.ping', handler)

    const methods = registry.getGatewayMethods()
    expect(methods).toHaveLength(1)
    expect(methods[0].extensionId).toBe('ext-test')
    expect(methods[0].method).toBe('custom.ping')
  })

  it('registerGatewayMethod — 核心命名空间拒绝', () => {
    expect(() => api.registerGatewayMethod('chat.send', async () => ({}))).toThrow(
      'namespace "chat" is protected'
    )
  })

  it('registerGatewayMethod — 多个方法', () => {
    api.registerGatewayMethod('ext.a', async () => ({}))
    api.registerGatewayMethod('ext.b', async () => ({}))

    expect(registry.getGatewayMethods()).toHaveLength(2)
  })

  // ---- 多 Extension 隔离 ----

  it('多 Extension API 隔离 — 各自注册互不干扰', () => {
    const api2 = createExtensionApi('ext-other', 'Other', 'builtin', registry)

    api.registerTool(makeTool('tool-a'))
    api2.registerTool(makeTool('tool-b'))

    api.on('session_start', async () => {})
    api2.on('session_end', async () => {})

    expect(registry.getTools()).toHaveLength(2)
    expect(registry.getHooks('session_start')).toHaveLength(1)
    expect(registry.getHooks('session_end')).toHaveLength(1)

    // 卸载 ext-test 不影响 ext-other
    registry.unregisterAll('ext-test')
    expect(registry.getTools()).toHaveLength(1)
    expect(registry.getTools()[0].extensionId).toBe('ext-other')
    expect(registry.getHooks('session_start')).toHaveLength(0)
    expect(registry.getHooks('session_end')).toHaveLength(1)
  })
})
