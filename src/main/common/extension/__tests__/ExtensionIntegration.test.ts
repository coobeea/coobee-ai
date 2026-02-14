/**
 * Extension 系统集成测试
 *
 * 验证 ExtensionManager 全流程：
 *   - Hook 注册 → 执行
 *   - 工具注册 → getTools
 *   - 多 Extension 组合
 *   - 错误隔离
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ExtensionRegistry } from '../ExtensionRegistry'
import { ExtensionManager } from '../ExtensionManager'
import { createExtensionApi } from '../ExtensionApi'
import { ToolCategory } from '../../../ai/tools/types'

describe('ExtensionIntegration', () => {
  let registry: ExtensionRegistry

  beforeEach(() => {
    registry = new ExtensionRegistry()
    ExtensionManager.initialize(registry)
  })

  afterEach(() => {
    ExtensionManager.reset()
  })

  it('before_agent_start: prependContext 注入', async () => {
    const api = createExtensionApi('ext-ctx', 'Context Extension', 'builtin', registry)
    api.on('before_agent_start', async () => ({
      prependContext: 'You have access to memory tools.'
    }))

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    })

    expect(result).toBeDefined()
    expect(result!.prependContext).toBe('You have access to memory tools.')
  })

  it('before_agent_start: replaceSystemPrompt 替换', async () => {
    const api = createExtensionApi('ext-sp', 'SystemPrompt Extension', 'user', registry)
    api.on('before_agent_start', async () => ({
      replaceSystemPrompt: 'You are a coding assistant.'
    }))

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    })

    expect(result!.replaceSystemPrompt).toBe('You are a coding assistant.')
  })

  it('before_agent_start: 无注册时正常不报错', async () => {
    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    })
    expect(result).toBeUndefined()
  })

  it('before_tool_call: block 工具不执行', async () => {
    const api = createExtensionApi('ext-block', 'Block Extension', 'user', registry)
    api.on('before_tool_call', async (event) => {
      if (event.toolName === 'exec') {
        return { block: true, blockReason: 'exec is forbidden' }
      }
      return undefined
    })

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'exec',
      params: { command: 'rm -rf /' }
    })

    expect(result!.block).toBe(true)
    expect(result!.blockReason).toBe('exec is forbidden')
  })

  it('before_tool_call: 修改 params', async () => {
    const api = createExtensionApi('ext-params', 'Params Extension', 'user', registry)
    api.on('before_tool_call', async () => ({
      params: { extra: 'injected' }
    }))

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'read',
      params: { path: '/test' }
    })

    expect(result!.params).toEqual({ extra: 'injected' })
  })

  it('after_tool_call: 触发并传递正确参数', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi('ext-after', 'After Extension', 'user', registry)
    api.on('after_tool_call', async (event) => {
      calls.push(event)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('after_tool_call', {
      sessionId: 's1',
      toolName: 'read',
      params: { path: '/test' },
      result: 'file content here',
      durationMs: 42
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as Record<string, unknown>).toolName).toBe('read')
    expect((calls[0] as Record<string, unknown>).durationMs).toBe(42)
  })

  it('tool_result_persist: 修改结果', async () => {
    const api = createExtensionApi('ext-persist', 'Persist Extension', 'user', registry)
    api.on('tool_result_persist', async () => ({
      result: 'modified result'
    }))

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('tool_result_persist', {
      sessionId: 's1',
      toolName: 'read',
      result: 'original result'
    })

    expect(result!.result).toBe('modified result')
  })

  it('agent_end: 触发并携带正确数据', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi('ext-end', 'End Extension', 'user', registry)
    api.on('agent_end', async (event) => {
      calls.push(event)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('agent_end', {
      sessionId: 's1',
      success: true,
      output: 'done',
      durationMs: 1234
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as Record<string, unknown>).success).toBe(true)
    expect((calls[0] as Record<string, unknown>).durationMs).toBe(1234)
  })

  it('多 Extension 组合: 按优先级执行', async () => {
    const api1 = createExtensionApi('ext-a', 'A', 'builtin', registry)
    api1.on('before_agent_start', async () => ({ prependContext: 'from-A' }), { priority: 10 })

    const api2 = createExtensionApi('ext-b', 'B', 'user', registry)
    api2.on('before_agent_start', async () => ({ prependContext: 'from-B' }), { priority: 50 })

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    })

    // B(50) 先执行，A(10) 后执行，prependContext 应拼接
    expect(result!.prependContext).toBe('from-B\nfrom-A')
  })

  it('hook 报错不影响其他 Extension', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: string[] = []

    const api1 = createExtensionApi('ext-bad', 'Bad', 'builtin', registry)
    api1.on('session_start', async () => {
      throw new Error('boom')
    })

    const api2 = createExtensionApi('ext-good', 'Good', 'user', registry)
    api2.on('session_start', async () => {
      calls.push('good')
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('session_start', { sessionId: 's1' })

    expect(calls).toContain('good')
    consoleSpy.mockRestore()
  })

  it('ExtensionManager 未初始化: 安全跳过', () => {
    ExtensionManager.reset()
    expect(ExtensionManager.getHookRunner()).toBeNull()
    expect(ExtensionManager.getRegistry()).toBeNull()
  })

  // ---- 补充维度 ----

  it('message_received: 触发并传递正确数据', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi('ext-msg', 'Msg Extension', 'user', registry)
    api.on('message_received', async (event) => {
      calls.push(event)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('message_received', {
      sessionId: 's1',
      message: 'hello from user'
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as Record<string, unknown>).sessionId).toBe('s1')
    expect((calls[0] as Record<string, unknown>).message).toBe('hello from user')
  })

  it('session_start: 触发并传递 sessionId', async () => {
    const sessions: string[] = []
    const api = createExtensionApi('ext-ss', 'SessionStart', 'user', registry)
    api.on('session_start', async (event) => {
      sessions.push(event.sessionId)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('session_start', { sessionId: 'sess-abc' })

    expect(sessions).toEqual(['sess-abc'])
  })

  it('session_end: 触发并传递 sessionId', async () => {
    const sessions: string[] = []
    const api = createExtensionApi('ext-se', 'SessionEnd', 'user', registry)
    api.on('session_end', async (event) => {
      sessions.push(event.sessionId)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('session_end', { sessionId: 'sess-xyz' })

    expect(sessions).toEqual(['sess-xyz'])
  })

  it('api.registerTool — 工具在 registry 中可见', () => {
    const api = createExtensionApi('ext-tool', 'Tool', 'user', registry)
    api.registerTool({
      name: 'custom-tool',
      description: 'Custom tool',
      category: ToolCategory.Extension,
      parameters: {} as never,
      // eslint-disable-next-line require-yield
      execute: async function* () {
        return { success: true, llmContent: 'done' }
      }
    })

    const tools = registry.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].tool.name).toBe('custom-tool')
    expect(tools[0].extensionId).toBe('ext-tool')
  })

  it('api.registerGatewayMethod — 方法在 registry 中可见', () => {
    const api = createExtensionApi('ext-gw', 'GW', 'user', registry)
    api.registerGatewayMethod('ext.greet', async () => ({ hello: true }))

    const methods = registry.getGatewayMethods()
    expect(methods).toHaveLength(1)
    expect(methods[0].method).toBe('ext.greet')
    expect(methods[0].extensionId).toBe('ext-gw')
  })

  it('before_tool_call: 非匹配工具不拦截', async () => {
    const api = createExtensionApi('ext-selective', 'Selective', 'user', registry)
    api.on('before_tool_call', async (event) => {
      if (event.toolName === 'dangerous_tool') {
        return { block: true, blockReason: 'blocked' }
      }
      return undefined
    })

    const runner = ExtensionManager.getHookRunner()!

    // 非匹配工具不应被阻止
    const safeResult = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'safe_tool',
      params: {}
    })
    expect(safeResult?.block).toBeFalsy()

    // 匹配工具被阻止
    const dangerResult = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'dangerous_tool',
      params: {}
    })
    expect(dangerResult!.block).toBe(true)
  })

  it('agent_end 失败事件 — success 为 false', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi('ext-fail', 'Fail', 'user', registry)
    api.on('agent_end', async (event) => {
      calls.push(event)
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('agent_end', {
      sessionId: 's1',
      success: false,
      output: 'error occurred',
      durationMs: 500
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as Record<string, unknown>).success).toBe(false)
    expect((calls[0] as Record<string, unknown>).output).toBe('error occurred')
  })

  it('tool_result_persist: 不返回 result 时保持原值', async () => {
    const api = createExtensionApi('ext-noop', 'Noop', 'user', registry)
    api.on('tool_result_persist', async () => ({}))

    const runner = ExtensionManager.getHookRunner()!
    const result = await runner.runModifyingHook('tool_result_persist', {
      sessionId: 's1',
      toolName: 'read',
      result: 'original'
    })

    // handler 返回 {}，无 result 属性，因此 undefined
    expect(result!.result).toBeUndefined()
  })

  it('多 Extension 不同 hook 类型全部执行', async () => {
    const log: string[] = []

    const api1 = createExtensionApi('ext-1', 'One', 'builtin', registry)
    api1.on('session_start', async () => {
      log.push('session_start')
    })

    const api2 = createExtensionApi('ext-2', 'Two', 'user', registry)
    api2.on('message_received', async () => {
      log.push('message_received')
    })

    const api3 = createExtensionApi('ext-3', 'Three', 'workspace', registry)
    api3.on('session_end', async () => {
      log.push('session_end')
    })

    const runner = ExtensionManager.getHookRunner()!
    await runner.runVoidHook('session_start', { sessionId: 's1' })
    await runner.runVoidHook('message_received', { sessionId: 's1', message: 'hi' })
    await runner.runVoidHook('session_end', { sessionId: 's1' })

    expect(log).toEqual(['session_start', 'message_received', 'session_end'])
  })

  it('before_agent_start + before_tool_call 组合 — 独立执行', async () => {
    const api = createExtensionApi('ext-combo', 'Combo', 'user', registry)
    api.on('before_agent_start', async () => ({ prependContext: 'ctx-injected' }))
    api.on('before_tool_call', async () => ({ params: { injected: true } }))

    const runner = ExtensionManager.getHookRunner()!

    const agentResult = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    })
    expect(agentResult!.prependContext).toBe('ctx-injected')

    const toolResult = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'read',
      params: {}
    })
    expect(toolResult!.params).toEqual({ injected: true })
  })

  it('卸载 Extension 后 hook 不再触发', async () => {
    const calls: string[] = []
    const api = createExtensionApi('ext-remove', 'Remove', 'user', registry)
    api.on('session_start', async () => {
      calls.push('called')
    })

    const runner = ExtensionManager.getHookRunner()!

    // 调用前
    await runner.runVoidHook('session_start', { sessionId: 's1' })
    expect(calls).toEqual(['called'])

    // 卸载
    registry.unregisterAll('ext-remove')

    // 调用后
    await runner.runVoidHook('session_start', { sessionId: 's2' })
    expect(calls).toEqual(['called']) // 不应增加
  })

  it('ExtensionManager 重复初始化 — 覆盖', () => {
    const registry2 = new ExtensionRegistry()
    ExtensionManager.initialize(registry2)
    expect(ExtensionManager.getRegistry()).toBe(registry2)
    expect(ExtensionManager.getRegistry()).not.toBe(registry)
  })
})
