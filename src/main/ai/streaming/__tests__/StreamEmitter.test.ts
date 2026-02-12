/**
 * StreamEmitter 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEventBus = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
}))

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}))

vi.mock('@main/utils', () => ({
  SnowflakeIdGenerator: class MockSnowflakeIdGenerator {
    private counter = 0
    nextId(): string {
      return `snowflake-${++this.counter}`
    }
  }
}))

import { StreamEmitter, createStreamEmitter } from '../StreamEmitter'
import { StreamEventType } from '../types'

describe('StreamEmitter', () => {
  let emitter: StreamEmitter
  const source = { type: 'agent' as const, id: 'agent-1', name: 'TestAgent' }

  beforeEach(() => {
    vi.clearAllMocks()
    emitter = new StreamEmitter('session-1', source)
  })

  describe('forward', () => {
    it('将 text:delta 转发为 text 消息', () => {
      emitter.forward({ type: 'text:delta', content: 'hello', data: { delta: 'hello' } })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          type: StreamEventType.MESSAGE,
          sessionId: 'session-1',
          message: expect.objectContaining({
            type: 'text',
            content: 'hello',
            sequence: 1,
            source
          })
        })
      )
    })

    it('将 reasoning:delta 转发为 thinking 消息', () => {
      emitter.forward({
        type: 'reasoning:delta',
        content: 'processing...',
        data: { delta: 'processing...' }
      })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'thinking', content: 'processing...' })
        })
      )
    })

    it('将 tool:start 转发为 tool_call 消息', () => {
      emitter.forward({
        type: 'tool:start',
        content: 'search',
        data: { toolName: 'search', callId: 'call-1' }
      })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'tool_call',
            content: 'search',
            data: { toolName: 'search', callId: 'call-1' }
          })
        })
      )
    })

    it('将 tool:done 转发为 tool_result 消息', () => {
      emitter.forward({
        type: 'tool:done',
        content: '{"result": "ok"}',
        data: { toolName: 'search', output: '{"result": "ok"}' }
      })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'tool_result' })
        })
      )
    })

    it('run:start 同时触发 MESSAGE 和 START 生命周期事件', () => {
      emitter.forward({ type: 'run:start', content: '' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'start' })
        })
      )
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.START,
        expect.objectContaining({ type: StreamEventType.START, sessionId: 'session-1' })
      )
    })

    it('run:done 同时触发 MESSAGE 和 END 生命周期事件', () => {
      emitter.forward({ type: 'run:done', content: '' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(StreamEventType.END, expect.anything())
    })

    it('run:error 同时触发 MESSAGE 和 ERROR 生命周期事件', () => {
      emitter.forward({ type: 'run:error', content: 'something failed' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.ERROR,
        expect.objectContaining({ error: 'something failed' })
      )
    })

    it('跳过无 EventBus 映射的事件（如 turn:start）', () => {
      emitter.forward({ type: 'turn:start', content: '' })

      expect(mockEventBus.emit).not.toHaveBeenCalled()
    })
  })

  describe('emit', () => {
    it('直接按 StreamMessageType 发送消息', async () => {
      await emitter.emit('agent_updated', 'Agent updated: TestAgent', { agentName: 'TestAgent' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'agent_updated',
            content: 'Agent updated: TestAgent',
            data: { agentName: 'TestAgent' }
          })
        })
      )
    })
  })

  describe('序号递增', () => {
    it('消息序号单调递增', () => {
      emitter.forward({ type: 'text:delta', content: '1', data: { delta: '1' } })
      emitter.forward({ type: 'text:delta', content: '2', data: { delta: '2' } })
      emitter.forward({ type: 'text:delta', content: '3', data: { delta: '3' } })

      const calls = mockEventBus.emit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c[0] === StreamEventType.MESSAGE
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sequences = calls.map((c: any) => c[1].message.sequence)
      expect(sequences).toEqual([1, 2, 3])
    })
  })

  describe('createStreamEmitter 工厂', () => {
    it('创建 IStreamEmitter 实例', () => {
      const e = createStreamEmitter('s1', source)
      expect(e).toBeDefined()
      expect(typeof e.forward).toBe('function')
      expect(typeof e.emit).toBe('function')
    })
  })
})
