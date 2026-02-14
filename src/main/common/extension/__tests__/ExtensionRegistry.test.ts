import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ExtensionRegistry } from '../ExtensionRegistry'
import { ExtensionManager } from '../ExtensionManager'
import type { RegisteredExtensionHook } from '../types'
import { ToolCategory } from '../../../ai/tools/types'
import type { ToolDefinition } from '../../../ai/tools/types'
import { z } from 'zod'

/** 创建一个最小工具定义用于测试 */
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

describe('ExtensionRegistry', () => {
  let registry: ExtensionRegistry

  beforeEach(() => {
    registry = new ExtensionRegistry()
  })

  // ---- 工具 ----

  it('registerTool + getTools — 正常注册', () => {
    registry.registerTool('ext-a', makeTool('tool-1'))
    const tools = registry.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].extensionId).toBe('ext-a')
    expect(tools[0].tool.name).toBe('tool-1')
  })

  it('工具名重复拒绝', () => {
    registry.registerTool('ext-a', makeTool('dup'))
    expect(() => registry.registerTool('ext-b', makeTool('dup'))).toThrow(
      'Tool "dup" already registered'
    )
  })

  // ---- Hook ----

  it('registerHook + getHooks — 正常注册、按 hookName 过滤', () => {
    const hook: RegisteredExtensionHook<'session_start'> = {
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    }
    registry.registerHook(hook)
    expect(registry.getHooks('session_start')).toHaveLength(1)
    expect(registry.getHooks('session_end')).toHaveLength(0)
  })

  it('Hook 优先级排序 — 高优先级先返回', () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'agent_end',
      handler: async () => {},
      priority: 10
    })
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'agent_end',
      handler: async () => {},
      priority: 50
    })
    registry.registerHook({
      extensionId: 'ext-c',
      hookName: 'agent_end',
      handler: async () => {},
      priority: 30
    })
    const hooks = registry.getHooks('agent_end')
    expect(hooks.map((h) => h.extensionId)).toEqual(['ext-b', 'ext-c', 'ext-a'])
  })

  // ---- Gateway 方法 ----

  it('registerGatewayMethod — 正常注册', () => {
    const handler = async (): Promise<Record<string, unknown>> => ({ ok: true })
    registry.registerGatewayMethod('ext-a', 'custom.ping', handler)
    expect(registry.getGatewayMethods()).toHaveLength(1)
    expect(registry.getGatewayMethods()[0].method).toBe('custom.ping')
  })

  it('Gateway 方法名冲突 — 核心命名空间拒绝', () => {
    const handler = async (): Promise<Record<string, unknown>> => ({})
    expect(() => registry.registerGatewayMethod('ext-a', 'chat.send', handler)).toThrow(
      'namespace "chat" is protected'
    )
    expect(() => registry.registerGatewayMethod('ext-a', 'stream.subscribe', handler)).toThrow(
      'namespace "stream" is protected'
    )
    expect(() => registry.registerGatewayMethod('ext-a', 'worker.start', handler)).toThrow(
      'namespace "worker" is protected'
    )
    expect(() => registry.registerGatewayMethod('ext-a', 'hitl.approve', handler)).toThrow(
      'namespace "hitl" is protected'
    )
  })

  // ---- 卸载 ----

  it('unregisterAll — 一键移除指定 extensionId 的所有注册', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    registry.registerTool('ext-b', makeTool('t2'))
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    })
    registry.registerGatewayMethod('ext-a', 'custom.foo', async () => ({}))

    registry.unregisterAll('ext-a')

    expect(registry.getTools()).toHaveLength(1)
    expect(registry.getTools()[0].extensionId).toBe('ext-b')
    expect(registry.getHooks('session_start')).toHaveLength(0)
    expect(registry.getGatewayMethods()).toHaveLength(0)
  })

  it('unregisterToolsByExtension — 只移除该 Extension 的工具', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    registry.registerTool('ext-a', makeTool('t2'))
    registry.registerTool('ext-b', makeTool('t3'))

    const removed = registry.unregisterToolsByExtension('ext-a')
    expect(removed).toEqual(['t1', 't2'])
    expect(registry.getTools()).toHaveLength(1)
    expect(registry.getTools()[0].tool.name).toBe('t3')
  })

  it('unregisterHooksByExtension — 只移除该 Extension 的 hook', () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'agent_end',
      handler: async () => {},
      priority: 0
    })
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'agent_end',
      handler: async () => {},
      priority: 0
    })
    registry.unregisterHooksByExtension('ext-a')
    expect(registry.getHooks('agent_end')).toHaveLength(1)
    expect(registry.getHooks('agent_end')[0].extensionId).toBe('ext-b')
  })

  // ---- 补充维度 ----

  it('同一 Extension 注册多个工具 — 全部保留', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    registry.registerTool('ext-a', makeTool('t2'))
    registry.registerTool('ext-a', makeTool('t3'))

    const tools = registry.getTools()
    expect(tools).toHaveLength(3)
    expect(tools.every((t) => t.extensionId === 'ext-a')).toBe(true)
  })

  it('getExtensionIds — 汇集 tools、hooks、gatewayMethods 的唯一 ID', () => {
    registry.registerTool('ext-tool', makeTool('t1'))
    registry.registerHook({
      extensionId: 'ext-hook',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    })
    registry.registerGatewayMethod('ext-gw', 'custom.method', async () => ({}))
    // ext-tool 也注册一个 hook，测试去重
    registry.registerHook({
      extensionId: 'ext-tool',
      hookName: 'session_end',
      handler: async () => {},
      priority: 0
    })

    const ids = registry.getExtensionIds()
    expect(ids).toHaveLength(3)
    expect(ids).toContain('ext-tool')
    expect(ids).toContain('ext-hook')
    expect(ids).toContain('ext-gw')
  })

  it('Gateway 方法同名冲突 — 非核心命名空间也拒绝重复', () => {
    registry.registerGatewayMethod('ext-a', 'custom.hello', async () => ({}))
    expect(() => registry.registerGatewayMethod('ext-b', 'custom.hello', async () => ({}))).toThrow(
      'Gateway method "custom.hello" already registered'
    )
  })

  it('unregisterGatewayMethodsByExtension — 返回被移除的方法名列表', () => {
    registry.registerGatewayMethod('ext-a', 'custom.foo', async () => ({}))
    registry.registerGatewayMethod('ext-a', 'custom.bar', async () => ({}))
    registry.registerGatewayMethod('ext-b', 'custom.baz', async () => ({}))

    const removed = registry.unregisterGatewayMethodsByExtension('ext-a')
    expect(removed).toEqual(['custom.foo', 'custom.bar'])
    expect(registry.getGatewayMethods()).toHaveLength(1)
    expect(registry.getGatewayMethods()[0].method).toBe('custom.baz')
  })

  it('unregisterAll 对不存在的 extensionId — 无副作用', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    registry.unregisterAll('nonexistent')
    expect(registry.getTools()).toHaveLength(1)
  })

  it('getTools 返回浅拷贝 — 修改返回值不影响内部', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    const tools = registry.getTools()
    tools.pop()
    expect(registry.getTools()).toHaveLength(1)
  })

  it('getGatewayMethods 返回浅拷贝', () => {
    registry.registerGatewayMethod('ext-a', 'custom.test', async () => ({}))
    const methods = registry.getGatewayMethods()
    methods.pop()
    expect(registry.getGatewayMethods()).toHaveLength(1)
  })

  it('多种 Hook 类型并存 — 按 hookName 正确过滤', () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    })
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_end',
      handler: async () => {},
      priority: 0
    })
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'x' }),
      priority: 0
    })
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    })

    expect(registry.getHooks('session_start')).toHaveLength(2)
    expect(registry.getHooks('session_end')).toHaveLength(1)
    expect(registry.getHooks('before_agent_start')).toHaveLength(1)
    expect(registry.getHooks('message_received')).toHaveLength(0)
  })

  it('unregisterToolsByExtension 对不存在的 extensionId — 返回空数组', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    const removed = registry.unregisterToolsByExtension('nonexistent')
    expect(removed).toEqual([])
    expect(registry.getTools()).toHaveLength(1)
  })

  it('clear — 清空全部', () => {
    registry.registerTool('ext-a', makeTool('t1'))
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    })
    registry.registerGatewayMethod('ext-a', 'custom.bar', async () => ({}))

    registry.clear()

    expect(registry.getTools()).toHaveLength(0)
    expect(registry.getHooks('session_start')).toHaveLength(0)
    expect(registry.getGatewayMethods()).toHaveLength(0)
    expect(registry.getExtensionIds()).toHaveLength(0)
  })
})

// ---- ExtensionManager ----

describe('ExtensionManager', () => {
  afterEach(() => {
    ExtensionManager.reset()
  })

  it('initialize → getRegistry / getHookRunner 返回实例', () => {
    const reg = new ExtensionRegistry()
    ExtensionManager.initialize(reg)
    expect(ExtensionManager.getRegistry()).toBe(reg)
    expect(ExtensionManager.getHookRunner()).toBeDefined()
  })

  it('未初始化 → 返回 null', () => {
    expect(ExtensionManager.getRegistry()).toBeNull()
    expect(ExtensionManager.getHookRunner()).toBeNull()
  })

  it('reset → 回到未初始化状态', () => {
    const reg = new ExtensionRegistry()
    ExtensionManager.initialize(reg)
    expect(ExtensionManager.getRegistry()).not.toBeNull()

    ExtensionManager.reset()
    expect(ExtensionManager.getRegistry()).toBeNull()
    expect(ExtensionManager.getHookRunner()).toBeNull()
  })
})
