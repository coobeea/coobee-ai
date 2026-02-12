/**
 * StreamEmitter.forward() 测试
 *
 * 测试 P0 事件模型统一 — StreamChunk → StreamMessage 映射：
 * - text:delta → text
 * - reasoning:delta → thinking
 * - tool:start → tool_call
 * - tool:done → tool_result
 * - handoff:start → handoff
 * - hitl:required → hitl
 * - run:start → start（+ START 生命周期事件）
 * - run:done → done（+ END 生命周期事件）
 * - run:error → error（+ ERROR 生命周期事件）
 * - 不需要广播的事件（如 turn:start）被跳过
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

import { StreamEmitter } from '../StreamEmitter'
import { StreamEventType } from '../types'
import type { StreamChunk } from '../../runtime/types'

describe('StreamEmitter.forward()', () => {
  let emitter: StreamEmitter
  const source = { type: 'agent' as const, id: 'agent-1', name: 'TestAgent' }

  beforeEach(() => {
    vi.clearAllMocks()
    emitter = new StreamEmitter('session-1', source)
  })

  // ========== 文本映射 ==========

  describe('文本事件映射', () => {
    it('text:delta → text StreamMessage', () => {
      const chunk: StreamChunk = {
        type: 'text:delta',
        content: 'hello',
        data: { delta: 'hello' }
      }

      emitter.forward(chunk)

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            type: 'text',
            content: 'hello',
            sequence: 1,
            sessionId: 'session-1'
          })
        })
      )
    })

    it('reasoning:delta → thinking StreamMessage', () => {
      const chunk: StreamChunk = {
        type: 'reasoning:delta',
        content: 'thinking...'
      }

      emitter.forward(chunk)

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'thinking', content: 'thinking...' })
        })
      )
    })
  })

  // ========== 工具事件映射 ==========

  describe('工具事件映射', () => {
    it('tool:start → tool_call StreamMessage', () => {
      const chunk: StreamChunk = {
        type: 'tool:start',
        content: 'search',
        data: { toolName: 'search', callId: 'call-1' }
      }

      emitter.forward(chunk)

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'tool_call' })
        })
      )
    })

    it('tool:done → tool_result StreamMessage', () => {
      const chunk: StreamChunk = {
        type: 'tool:done',
        content: 'result',
        data: { toolName: 'search', output: 'found it' }
      }

      emitter.forward(chunk)

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'tool_result' })
        })
      )
    })
  })

  // ========== Handoff / HITL 映射 ==========

  describe('Handoff / HITL 映射', () => {
    it('handoff:start → handoff StreamMessage', () => {
      emitter.forward({ type: 'handoff:start', content: 'Agent B', data: { toAgent: 'B' } })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'handoff' })
        })
      )
    })

    it('hitl:required → hitl StreamMessage', () => {
      emitter.forward({ type: 'hitl:required', content: 'approval needed' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'hitl' })
        })
      )
    })
  })

  // ========== 生命周期事件映射 ==========

  describe('生命周期事件映射', () => {
    it('run:start → start + START 生命周期事件', () => {
      emitter.forward({ type: 'run:start', content: '' })

      // 1) MESSAGE 事件（type: start）
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'start' })
        })
      )

      // 2) START 生命周期事件
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.START,
        expect.objectContaining({
          type: StreamEventType.START,
          sessionId: 'session-1',
          source
        })
      )
    })

    it('run:done → done + END 生命周期事件', () => {
      emitter.forward({ type: 'run:done', content: '' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'done' })
        })
      )

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.END,
        expect.objectContaining({ type: StreamEventType.END })
      )
    })

    it('run:error → error + ERROR 生命周期事件（含 error 字段）', () => {
      emitter.forward({ type: 'run:error', content: 'something broke' })

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'error', content: 'something broke' })
        })
      )

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.ERROR,
        expect.objectContaining({
          error: 'something broke'
        })
      )
    })
  })

  // ========== 跳过的事件 ==========

  describe('不需要广播的事件', () => {
    it.each([
      'turn:start',
      'turn:done',
      'llm:start',
      'llm:done',
      'text:start',
      'text:done',
      'reasoning:start',
      'reasoning:done',
      'tool:delta',
      'tool:pending',
      'compression:start',
      'compression:done'
    ] as const)('%s 不触发 EventBus 事件', (type) => {
      emitter.forward({ type, content: '' })

      // 这些事件不应触发任何 EventBus emit
      expect(mockEventBus.emit).not.toHaveBeenCalled()
    })
  })

  // ========== 序号递增 ==========

  describe('序号递增', () => {
    it('forward 产生的消息序号单调递增', () => {
      emitter.forward({ type: 'text:delta', content: '1' })
      emitter.forward({ type: 'text:delta', content: '2' })
      emitter.forward({ type: 'text:delta', content: '3' })

      const calls = mockEventBus.emit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c[0] === StreamEventType.MESSAGE
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sequences = calls.map((c: any) => c[1].message.sequence)
      expect(sequences).toEqual([1, 2, 3])
    })
  })
})
