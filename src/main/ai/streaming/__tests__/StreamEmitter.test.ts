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

  describe('emitText', () => {
    it('发射文本消息', async () => {
      await emitter.emitText('hello world')

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          type: StreamEventType.MESSAGE,
          sessionId: 'session-1',
          message: expect.objectContaining({
            type: 'text',
            content: 'hello world',
            sequence: 1,
            source
          })
        })
      )
    })
  })

  describe('emitThinking', () => {
    it('发射思考消息', async () => {
      await emitter.emitThinking('processing...')

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'thinking', content: 'processing...' })
        })
      )
    })
  })

  describe('emitToolCall', () => {
    it('发射工具调用事件', async () => {
      await emitter.emitToolCall('search', { query: 'test' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'tool_call',
            data: { toolName: 'search', args: { query: 'test' } }
          })
        })
      )
    })
  })

  describe('emitStart / emitDone', () => {
    it('emitStart 发送 START 和 MESSAGE 事件', async () => {
      await emitter.emitStart()

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

    it('emitDone 发送 END 和 MESSAGE 事件', async () => {
      await emitter.emitDone()

      expect(mockEventBus.emit).toHaveBeenCalledWith(StreamEventType.END, expect.anything())
    })
  })

  describe('emitError', () => {
    it('发送 ERROR 事件', async () => {
      await emitter.emitError('something failed')

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.ERROR,
        expect.objectContaining({ error: 'something failed' })
      )
    })

    it('接受 Error 对象', async () => {
      await emitter.emitError(new Error('boom'))

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.ERROR,
        expect.objectContaining({ error: 'boom' })
      )
    })
  })

  describe('序号递增', () => {
    it('消息序号单调递增', async () => {
      await emitter.emitText('1')
      await emitter.emitText('2')
      await emitter.emitText('3')

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
      expect(typeof e.emitText).toBe('function')
    })
  })
})
