/**
 * AgentRuntime 测试
 *
 * 测试纯参数驱动的 AgentRuntime：
 * - 初始化（Agent 创建、FileSession、StreamEmitter）
 * - 同步执行 run()
 * - 流式执行 runStream()（8 层闭环事件覆盖）
 * - HITL 工具审批（暂停/恢复）
 * - 会话管理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockRun, mockStreamEmitter, mockFileSession } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockStreamEmitter: {
    emitStart: vi.fn().mockResolvedValue(undefined),
    emitDone: vi.fn().mockResolvedValue(undefined),
    emitError: vi.fn().mockResolvedValue(undefined),
    emitText: vi.fn().mockResolvedValue(undefined),
    emitThinking: vi.fn().mockResolvedValue(undefined),
    emitToolCall: vi.fn().mockResolvedValue(undefined),
    emitToolResult: vi.fn().mockResolvedValue(undefined),
    emitHandoff: vi.fn().mockResolvedValue(undefined),
    emitToolApproval: vi.fn().mockResolvedValue(undefined),
    emitAgentUpdated: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined)
  },
  mockFileSession: {
    getSessionId: vi.fn().mockResolvedValue('session-1'),
    getItems: vi.fn().mockResolvedValue([]),
    addItems: vi.fn().mockResolvedValue(undefined),
    popItem: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    getItemCount: vi.fn().mockResolvedValue(0),
    getFilePath: vi.fn().mockReturnValue('/tmp/test/messages.jsonl')
  }
}))

// ===== Mock @openai/agents =====
vi.mock('@openai/agents', () => ({
  Agent: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    return { name: config.name || 'TestAgent', ...config }
  }),
  run: (...args: unknown[]) => mockRun(...args)
}))

// ===== Mock FileSession =====
vi.mock('../FileSession', () => ({
  FileSession: vi.fn().mockImplementation(function () {
    return mockFileSession
  })
}))

// ===== Mock StreamEmitter =====
vi.mock('../../streaming/StreamEmitter', () => ({
  createStreamEmitter: vi.fn().mockReturnValue(mockStreamEmitter)
}))

import { AgentRuntime } from '../AgentRuntime'
import { Agent } from '@openai/agents'
import type { AgentRuntimeOptions } from '../types'

function createOptions(overrides?: Partial<AgentRuntimeOptions>): AgentRuntimeOptions {
  return {
    name: 'TestAgent',
    instructions: 'You are a helpful assistant.',
    model: 'gpt-4o',
    sessionId: 'session-1',
    ...overrides
  }
}

describe('AgentRuntime', () => {
  let runtime: AgentRuntime

  beforeEach(() => {
    vi.clearAllMocks()
    mockFileSession.getItemCount.mockResolvedValue(0)
    runtime = new AgentRuntime(createOptions())
  })

  // ===== 初始化 =====

  describe('initialize', () => {
    it('创建 Agent 实例', async () => {
      await runtime.initialize()

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'TestAgent',
          instructions: 'You are a helpful assistant.',
          model: 'gpt-4o'
        })
      )
    })

    it('传入 tools 时包含在 Agent 配置中', async () => {
      const mockTool = { name: 'testTool', type: 'function' }
      runtime = new AgentRuntime(createOptions({ tools: [mockTool as never] }))
      await runtime.initialize()

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [mockTool]
        })
      )
    })

    it('传入 handoffs 时包含在 Agent 配置中', async () => {
      const mockHandoff = { name: 'AgentB' }
      runtime = new AgentRuntime(createOptions({ handoffs: [mockHandoff as never] }))
      await runtime.initialize()

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          handoffs: [mockHandoff]
        })
      )
    })

    it('传入 modelSettings', async () => {
      runtime = new AgentRuntime(createOptions({ modelSettings: { temperature: 0.5 } as never }))
      await runtime.initialize()

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSettings: { temperature: 0.5 }
        })
      )
    })
  })

  // ===== 属性 =====

  describe('属性', () => {
    it('name 返回配置名称', () => {
      expect(runtime.name).toBe('TestAgent')
    })

    it('type 为 agent', () => {
      expect(runtime.type).toBe('agent')
    })

    it('interrupted 初始为 false', () => {
      expect(runtime.interrupted).toBe(false)
    })
  })

  // ===== 同步执行 =====

  describe('run', () => {
    beforeEach(async () => {
      await runtime.initialize()
    })

    it('成功执行并返回结果', async () => {
      mockRun.mockResolvedValue({
        finalOutput: 'Hello!',
        lastResponseId: 'resp-1',
        newItems: [],
        interruptions: []
      })

      const result = await runtime.run('Hi')

      expect(result.output).toBe('Hello!')
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.metadata?.sessionId).toBe('session-1')
      expect(result.metadata?.responseId).toBe('resp-1')
    })

    it('传入 session 参数给 SDK', async () => {
      mockRun.mockResolvedValue({
        finalOutput: 'ok',
        newItems: [],
        interruptions: []
      })

      await runtime.run('test')

      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(), // agent
        'test', // input
        expect.objectContaining({
          session: mockFileSession,
          maxTurns: 25
        })
      )
    })

    it('使用自定义 maxTurns', async () => {
      runtime = new AgentRuntime(createOptions({ maxTurns: 10 }))
      await runtime.initialize()
      mockRun.mockResolvedValue({
        finalOutput: 'ok',
        newItems: [],
        interruptions: []
      })

      await runtime.run('test')

      expect(mockRun).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        expect.objectContaining({ maxTurns: 10 })
      )
    })

    it('多轮对话传递 previousResponseId', async () => {
      mockRun
        .mockResolvedValueOnce({
          finalOutput: 'first',
          lastResponseId: 'resp-1',
          newItems: [],
          interruptions: []
        })
        .mockResolvedValueOnce({
          finalOutput: 'second',
          lastResponseId: 'resp-2',
          newItems: [],
          interruptions: []
        })

      await runtime.run('msg1')
      await runtime.run('msg2')

      // 第二次调用应包含 previousResponseId
      expect(mockRun.mock.calls[1][2]).toEqual(
        expect.objectContaining({
          previousResponseId: 'resp-1'
        })
      )
    })

    it('HITL 中断返回 interrupted 结果', async () => {
      const mockApprovalItem = {
        type: 'tool_approval_item',
        name: 'dangerous_tool',
        arguments: '{"target": "prod"}'
      }
      mockRun.mockResolvedValue({
        finalOutput: '',
        newItems: [],
        interruptions: [mockApprovalItem],
        state: { approve: vi.fn(), reject: vi.fn() }
      })

      const result = await runtime.run('do dangerous thing')

      expect(result.interrupted).toBe(true)
      expect(result.interruptions).toHaveLength(1)
      expect(result.interruptions![0].toolName).toBe('dangerous_tool')
      expect(runtime.interrupted).toBe(true)
    })
  })

  // ===== 流式执行 =====

  describe('runStream', () => {
    beforeEach(async () => {
      await runtime.initialize()
    })

    it('消费完整 text 闭环：text:start → text:delta → text:done', async () => {
      const events = [
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_started' }
        },
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: { type: 'response.output_item.added', item: { type: 'message' } }
          }
        },
        {
          type: 'raw_model_stream_event',
          data: { type: 'output_text_delta', delta: 'Hello ' }
        },
        {
          type: 'raw_model_stream_event',
          data: { type: 'output_text_delta', delta: 'world' }
        },
        {
          type: 'run_item_stream_event',
          name: 'message_output_created',
          item: { type: 'message_output_item', content: 'Hello world' }
        },
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_done', response: { id: 'r1' } }
        }
      ]

      mockRun.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
        completed: Promise.resolve(),
        finalOutput: 'Hello world',
        lastResponseId: 'resp-1',
        newItems: [],
        interruptions: [],
        state: {}
      })

      const chunks: Array<{ type: string; content: string; data?: unknown }> = []
      await runtime.runStream('Hi', {}, (chunk) => chunks.push(chunk))

      // 验证 run 闭环
      expect(chunks[0].type).toBe('run:start')
      expect(chunks[chunks.length - 1].type).toBe('run:done')

      // 验证 turn 闭环
      const turnStart = chunks.filter((c) => c.type === 'turn:start')
      expect(turnStart).toHaveLength(1)
      const turnDone = chunks.filter((c) => c.type === 'turn:done')
      expect(turnDone).toHaveLength(1)

      // 验证 llm 闭环
      const llmStart = chunks.filter((c) => c.type === 'llm:start')
      expect(llmStart).toHaveLength(1)
      const llmDone = chunks.filter((c) => c.type === 'llm:done')
      expect(llmDone).toHaveLength(1)

      // 验证 text 闭环
      const textStart = chunks.filter((c) => c.type === 'text:start')
      expect(textStart).toHaveLength(1)

      const textDeltas = chunks.filter((c) => c.type === 'text:delta')
      expect(textDeltas).toHaveLength(2)
      expect(textDeltas[0].content).toBe('Hello ')
      expect(textDeltas[1].content).toBe('world')

      const textDone = chunks.filter((c) => c.type === 'text:done')
      expect(textDone).toHaveLength(1)
      expect(textDone[0].content).toBe('Hello world')
    })

    it('消费完整 llm 闭环：llm:start → llm:done（含 usage）', async () => {
      const events = [
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_started' }
        },
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'response_done',
            response: {
              id: 'resp-1',
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
            }
          }
        }
      ]

      mockRun.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
        completed: Promise.resolve(),
        finalOutput: 'ok',
        newItems: [],
        interruptions: [],
        state: {}
      })

      const chunks: Array<{ type: string; content: string; data?: unknown }> = []
      await runtime.runStream('test', {}, (chunk) => chunks.push(chunk))

      const llmStart = chunks.filter((c) => c.type === 'llm:start')
      expect(llmStart).toHaveLength(1)

      const llmDone = chunks.filter((c) => c.type === 'llm:done')
      expect(llmDone).toHaveLength(1)
      expect((llmDone[0].data as { usage?: { totalTokens: number } })?.usage?.totalTokens).toBe(30)
    })

    it('消费完整 tool 闭环：tool:start → tool:delta → tool:pending → tool:done', async () => {
      const events = [
        // response_started → turn:start + llm:start
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_started' }
        },
        // tool:start via model透传
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: {
              type: 'response.output_item.added',
              item: { type: 'function_call', name: 'get_weather', call_id: 'call-1' }
            }
          }
        },
        // tool_called via run_item
        {
          type: 'run_item_stream_event',
          name: 'tool_called',
          item: {
            type: 'tool_call_item',
            rawItem: {
              type: 'function_call',
              name: 'get_weather',
              arguments: '{"city":"Beijing"}',
              call_id: 'call-1'
            }
          }
        },
        // tool:delta
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: {
              type: 'response.function_call_arguments.delta',
              delta: '{"city":',
              call_id: 'call-1'
            }
          }
        },
        // tool:pending
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: {
              type: 'response.function_call_arguments.done',
              arguments: '{"city":"Beijing"}',
              call_id: 'call-1'
            }
          }
        },
        // response_done → llm:done
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_done', response: { id: 'r1' } }
        },
        // tool:done
        {
          type: 'run_item_stream_event',
          name: 'tool_output',
          item: {
            type: 'tool_call_output_item',
            rawItem: { name: 'get_weather', call_id: 'call-1', output: 'Sunny 25°C' },
            output: 'Sunny 25°C'
          }
        }
      ]

      mockRun.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
        completed: Promise.resolve(),
        finalOutput: 'Weather is sunny',
        newItems: [],
        interruptions: [],
        state: {}
      })

      const chunks: Array<{ type: string; content: string; data?: unknown }> = []
      await runtime.runStream('weather?', {}, (chunk) => chunks.push(chunk))

      // tool:start
      const toolStart = chunks.filter((c) => c.type === 'tool:start')
      expect(toolStart).toHaveLength(1)
      expect(toolStart[0].content).toBe('get_weather')

      // tool:delta
      const toolDelta = chunks.filter((c) => c.type === 'tool:delta')
      expect(toolDelta).toHaveLength(1)
      expect(toolDelta[0].content).toBe('{"city":')

      // tool:pending
      const toolPending = chunks.filter((c) => c.type === 'tool:pending')
      expect(toolPending).toHaveLength(1)

      // tool:done
      const toolDone = chunks.filter((c) => c.type === 'tool:done')
      expect(toolDone).toHaveLength(1)
      expect(toolDone[0].content).toBe('Sunny 25°C')

      // turn 应被关闭（tool_output 后）
      const turnDone = chunks.filter((c) => c.type === 'turn:done')
      expect(turnDone.length).toBeGreaterThanOrEqual(1)
    })

    it('消费完整 reasoning 闭环：reasoning:start → reasoning:delta → reasoning:done', async () => {
      const events = [
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_started' }
        },
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: { type: 'response.output_item.added', item: { type: 'reasoning' } }
          }
        },
        {
          type: 'raw_model_stream_event',
          data: {
            type: 'model',
            event: { type: 'response.reasoning_text.delta', delta: 'Let me think...' }
          }
        },
        {
          type: 'run_item_stream_event',
          name: 'reasoning_item_created',
          item: {
            type: 'reasoning_item',
            rawItem: {
              content: [{ text: 'I analyzed the question.' }],
              rawContent: [{ text: 'Let me think...' }]
            }
          }
        },
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_done', response: { id: 'r1' } }
        }
      ]

      mockRun.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
        completed: Promise.resolve(),
        finalOutput: 'thought result',
        newItems: [],
        interruptions: [],
        state: {}
      })

      const chunks: Array<{ type: string; content: string; data?: unknown }> = []
      await runtime.runStream('think', {}, (chunk) => chunks.push(chunk))

      // reasoning:start
      const started = chunks.filter((c) => c.type === 'reasoning:start')
      expect(started).toHaveLength(1)

      // reasoning:delta
      const deltas = chunks.filter((c) => c.type === 'reasoning:delta')
      expect(deltas).toHaveLength(1)
      expect(deltas[0].content).toBe('Let me think...')

      // reasoning:done
      const done = chunks.filter((c) => c.type === 'reasoning:done')
      expect(done).toHaveLength(1)
      expect(done[0].content).toBe('I analyzed the question.')
    })

    it('turn 状态追踪：无工具时 response_done 关闭 turn', async () => {
      const events = [
        { type: 'raw_model_stream_event', data: { type: 'response_started' } },
        {
          type: 'raw_model_stream_event',
          data: { type: 'output_text_delta', delta: 'Hi' }
        },
        {
          type: 'raw_model_stream_event',
          data: { type: 'response_done', response: { id: 'r1' } }
        }
      ]

      mockRun.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
        completed: Promise.resolve(),
        finalOutput: 'Hi',
        newItems: [],
        interruptions: [],
        state: {}
      })

      const chunks: Array<{ type: string; content: string; data?: unknown }> = []
      await runtime.runStream('test', {}, (chunk) => chunks.push(chunk))

      // 验证 turn 闭环
      const turnStart = chunks.filter((c) => c.type === 'turn:start')
      expect(turnStart).toHaveLength(1)
      expect((turnStart[0].data as { turnIndex: number }).turnIndex).toBe(1)

      const turnDone = chunks.filter((c) => c.type === 'turn:done')
      expect(turnDone).toHaveLength(1)
      expect((turnDone[0].data as { turnIndex: number }).turnIndex).toBe(1)
    })

    it('错误时发送 run:error 事件', async () => {
      mockRun.mockRejectedValue(new Error('API error'))

      const chunks: Array<{ type: string; content: string }> = []

      await expect(runtime.runStream('test', {}, (chunk) => chunks.push(chunk))).rejects.toThrow(
        'API error'
      )

      const errorChunks = chunks.filter((c) => c.type === 'run:error')
      expect(errorChunks).toHaveLength(1)
      expect(errorChunks[0].content).toBe('API error')
    })
  })

  // ===== HITL 工具审批 =====

  describe('HITL 工具审批', () => {
    let mockState: { approve: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> }

    beforeEach(async () => {
      await runtime.initialize()
      mockState = { approve: vi.fn(), reject: vi.fn() }
    })

    it('approve 调用 state.approve', async () => {
      const mockItem = { name: 'tool1', arguments: '{}' }
      mockRun.mockResolvedValue({
        finalOutput: '',
        newItems: [],
        interruptions: [mockItem],
        state: mockState
      })

      await runtime.run('do thing')
      runtime.approveToolCall(0)

      expect(mockState.approve).toHaveBeenCalledWith(mockItem, undefined)
    })

    it('reject 调用 state.reject', async () => {
      const mockItem = { name: 'tool1', arguments: '{}' }
      mockRun.mockResolvedValue({
        finalOutput: '',
        newItems: [],
        interruptions: [mockItem],
        state: mockState
      })

      await runtime.run('do thing')
      runtime.rejectToolCall(0, { alwaysReject: true })

      expect(mockState.reject).toHaveBeenCalledWith(mockItem, { alwaysReject: true })
    })

    it('resume 传入 pendingState 继续执行', async () => {
      const mockItem = { name: 'tool1', arguments: '{}' }
      mockRun
        .mockResolvedValueOnce({
          finalOutput: '',
          newItems: [],
          interruptions: [mockItem],
          state: mockState
        })
        .mockResolvedValueOnce({
          finalOutput: 'resumed result',
          lastResponseId: 'resp-2',
          newItems: [],
          interruptions: []
        })

      await runtime.run('do thing')
      runtime.approveToolCall(0)
      const result = await runtime.resume()

      expect(result.output).toBe('resumed result')
      expect(runtime.interrupted).toBe(false)
      // resume 应传入 state
      expect(mockRun.mock.calls[1][1]).toBe(mockState)
    })

    it('无中断时 approve 抛出错误', () => {
      expect(() => runtime.approveToolCall(0)).toThrow('No pending interruption')
    })

    it('无中断时 resume 抛出错误', async () => {
      await expect(runtime.resume()).rejects.toThrow('No pending interruption')
    })

    it('无效索引抛出错误', async () => {
      const mockItem = { name: 'tool1', arguments: '{}' }
      mockRun.mockResolvedValue({
        finalOutput: '',
        newItems: [],
        interruptions: [mockItem],
        state: mockState
      })

      await runtime.run('do thing')
      expect(() => runtime.approveToolCall(5)).toThrow('Invalid interruption index')
    })
  })

  // ===== 会话管理 =====

  describe('会话管理', () => {
    beforeEach(async () => {
      await runtime.initialize()
    })

    it('getSession 返回会话信息', async () => {
      mockFileSession.getItemCount.mockResolvedValue(5)

      const session = await runtime.getSession()

      expect(session.sessionId).toBe('session-1')
      expect(session.messageCount).toBe(5)
      expect(session.metadata?.agentName).toBe('TestAgent')
    })

    it('clearSession 清空会话', async () => {
      mockRun.mockResolvedValue({
        finalOutput: 'ok',
        lastResponseId: 'resp-1',
        newItems: [],
        interruptions: []
      })

      await runtime.run('test')
      await runtime.clearSession()

      expect(mockFileSession.clearSession).toHaveBeenCalled()
    })
  })

  // ===== 销毁 =====

  describe('destroy', () => {
    it('清理内部状态', async () => {
      await runtime.initialize()
      await runtime.destroy()

      expect(runtime.interrupted).toBe(false)
    })
  })
})
