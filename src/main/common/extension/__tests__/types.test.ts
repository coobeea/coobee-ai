/**
 * Extension 类型和常量测试
 *
 * 验证：
 *   - EXTENSION_HOOK_MODE 映射完整且正确
 *   - Hook 模式分类正确（void / modifying）
 *   - 类型导出可用
 */
import { describe, it, expect } from 'vitest'
import { EXTENSION_HOOK_MODE } from '../types'
import type {
  ExtensionHookName,
  ExtensionHookMode,
  ExtensionManifest,
  ExtensionModule,
  ExtensionOrigin,
  ExtensionApi,
  RegisteredExtensionHook,
  RegisteredExtensionTool,
  RegisteredExtensionMethod,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  BeforeToolCallEvent,
  BeforeToolCallResult,
  ToolResultPersistEvent,
  ToolResultPersistResult,
  AgentEndEvent,
  AfterToolCallEvent,
  MessageReceivedEvent,
  SessionEvent
} from '../types'

describe('EXTENSION_HOOK_MODE', () => {
  it('包含全部 12 种 Hook', () => {
    const keys = Object.keys(EXTENSION_HOOK_MODE)
    expect(keys).toHaveLength(12)
    // 原始 8 种
    expect(keys).toContain('before_agent_start')
    expect(keys).toContain('agent_end')
    expect(keys).toContain('before_tool_call')
    expect(keys).toContain('after_tool_call')
    expect(keys).toContain('tool_result_persist')
    expect(keys).toContain('message_received')
    expect(keys).toContain('session_start')
    expect(keys).toContain('session_end')
    // Phase 1 新增 4 种
    expect(keys).toContain('turn_start')
    expect(keys).toContain('turn_end')
    expect(keys).toContain('before_compaction')
    expect(keys).toContain('after_compaction')
  })

  it('modifying 类型正确 — before_agent_start', () => {
    expect(EXTENSION_HOOK_MODE.before_agent_start).toBe('modifying')
  })

  it('modifying 类型正确 — before_tool_call', () => {
    expect(EXTENSION_HOOK_MODE.before_tool_call).toBe('modifying')
  })

  it('modifying 类型正确 — tool_result_persist', () => {
    expect(EXTENSION_HOOK_MODE.tool_result_persist).toBe('modifying')
  })

  it('void 类型正确 — agent_end', () => {
    expect(EXTENSION_HOOK_MODE.agent_end).toBe('void')
  })

  it('void 类型正确 — after_tool_call', () => {
    expect(EXTENSION_HOOK_MODE.after_tool_call).toBe('void')
  })

  it('void 类型正确 — message_received', () => {
    expect(EXTENSION_HOOK_MODE.message_received).toBe('void')
  })

  it('void 类型正确 — session_start', () => {
    expect(EXTENSION_HOOK_MODE.session_start).toBe('void')
  })

  it('void 类型正确 — session_end', () => {
    expect(EXTENSION_HOOK_MODE.session_end).toBe('void')
  })

  it('modifying 共 4 种', () => {
    const modifying = Object.entries(EXTENSION_HOOK_MODE)
      .filter(([, mode]) => mode === 'modifying')
      .map(([name]) => name)
    expect(modifying).toHaveLength(4)
    expect(modifying.sort()).toEqual(
      ['before_agent_start', 'before_compaction', 'before_tool_call', 'tool_result_persist'].sort()
    )
  })

  it('void 共 8 种', () => {
    const voidHooks = Object.entries(EXTENSION_HOOK_MODE)
      .filter(([, mode]) => mode === 'void')
      .map(([name]) => name)
    expect(voidHooks).toHaveLength(8)
    expect(voidHooks.sort()).toEqual(
      [
        'agent_end',
        'after_compaction',
        'after_tool_call',
        'message_received',
        'session_start',
        'session_end',
        'turn_start',
        'turn_end'
      ].sort()
    )
  })

  it('所有 mode 值只能是 "void" 或 "modifying"', () => {
    for (const mode of Object.values(EXTENSION_HOOK_MODE)) {
      expect(['void', 'modifying']).toContain(mode)
    }
  })
})

// 以下测试确保类型导出正确，编译通过即验证
describe('类型导出验证', () => {
  it('ExtensionManifest 结构正确', () => {
    const manifest: ExtensionManifest = {
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      description: 'optional'
    }
    expect(manifest.id).toBe('test')
    expect(manifest.version).toBe('1.0.0')
  })

  it('ExtensionManifest description 可选', () => {
    const manifest: ExtensionManifest = {
      id: 'test',
      name: 'Test',
      version: '1.0.0'
    }
    expect(manifest.description).toBeUndefined()
  })

  it('ExtensionOrigin 三种取值', () => {
    const origins: ExtensionOrigin[] = ['builtin', 'user', 'workspace']
    expect(origins).toHaveLength(3)
  })

  it('ExtensionHookName 8 种取值', () => {
    const names: ExtensionHookName[] = [
      'before_agent_start',
      'agent_end',
      'before_tool_call',
      'after_tool_call',
      'tool_result_persist',
      'message_received',
      'session_start',
      'session_end'
    ]
    expect(names).toHaveLength(8)
  })

  it('ExtensionHookMode 两种取值', () => {
    const modes: ExtensionHookMode[] = ['void', 'modifying']
    expect(modes).toHaveLength(2)
  })

  it('BeforeAgentStartEvent 结构', () => {
    const event: BeforeAgentStartEvent = {
      sessionId: 's1',
      prompt: 'hello',
      systemPrompt: 'optional'
    }
    expect(event.sessionId).toBeDefined()
    expect(event.systemPrompt).toBe('optional')
  })

  it('BeforeAgentStartResult 结构', () => {
    const result: BeforeAgentStartResult = {
      prependContext: 'ctx',
      replaceSystemPrompt: 'sp'
    }
    expect(result.prependContext).toBe('ctx')
  })

  it('BeforeToolCallEvent 结构', () => {
    const event: BeforeToolCallEvent = {
      sessionId: 's1',
      toolName: 'exec',
      params: { command: 'ls' }
    }
    expect(event.toolName).toBe('exec')
  })

  it('BeforeToolCallResult 结构', () => {
    const result: BeforeToolCallResult = {
      block: true,
      blockReason: 'no',
      params: { x: 1 }
    }
    expect(result.block).toBe(true)
  })

  it('ToolResultPersistEvent 结构', () => {
    const event: ToolResultPersistEvent = {
      sessionId: 's1',
      toolName: 'read',
      result: 'content'
    }
    expect(event.result).toBe('content')
  })

  it('ToolResultPersistResult 结构', () => {
    const result: ToolResultPersistResult = { result: 'modified' }
    expect(result.result).toBe('modified')
  })

  it('AgentEndEvent 结构', () => {
    const event: AgentEndEvent = {
      sessionId: 's1',
      success: true,
      output: 'done',
      durationMs: 1000
    }
    expect(event.success).toBe(true)
  })

  it('AfterToolCallEvent 结构', () => {
    const event: AfterToolCallEvent = {
      sessionId: 's1',
      toolName: 'exec',
      params: {},
      result: 'ok',
      durationMs: 50
    }
    expect(event.durationMs).toBe(50)
  })

  it('MessageReceivedEvent 结构', () => {
    const event: MessageReceivedEvent = {
      sessionId: 's1',
      message: 'hello'
    }
    expect(event.message).toBe('hello')
  })

  it('SessionEvent 结构', () => {
    const event: SessionEvent = { sessionId: 's1' }
    expect(event.sessionId).toBe('s1')
  })

  // 以下类型仅验证编译通过
  it('RegisteredExtensionHook 泛型兼容', () => {
    const hook: RegisteredExtensionHook<'session_start'> = {
      extensionId: 'ext',
      hookName: 'session_start',
      handler: async () => {},
      priority: 0
    }
    expect(hook.hookName).toBe('session_start')
  })

  it('RegisteredExtensionTool 结构', () => {
    const rt: RegisteredExtensionTool = {
      extensionId: 'ext',
      tool: {} as never // 只验证结构编译
    }
    expect(rt.extensionId).toBe('ext')
  })

  it('RegisteredExtensionMethod 结构', () => {
    const rm: RegisteredExtensionMethod = {
      extensionId: 'ext',
      method: 'custom.ping',
      handler: async () => ({})
    }
    expect(rm.method).toBe('custom.ping')
  })

  it('ExtensionModule 结构', () => {
    const mod: ExtensionModule = {
      id: 'test',
      name: 'Test',
      register: () => {}
    }
    expect(mod.id).toBe('test')
    expect(typeof mod.register).toBe('function')
  })

  it('ExtensionApi 接口包含所有方法', () => {
    // 验证接口属性存在（编译级别）
    const api = {} as ExtensionApi
    expect(typeof api.id).toBeDefined()
    expect(typeof api.name).toBeDefined()
    expect(typeof api.origin).toBeDefined()
    expect(typeof api.logger).toBeDefined()
    expect(typeof api.registerTool).toBeDefined()
    expect(typeof api.on).toBeDefined()
    expect(typeof api.registerGatewayMethod).toBeDefined()
  })
})
