/**
 * StreamChannel 测试
 *
 * 测试 AI 流式频道：
 * - subscribe/unsubscribe 管理
 * - 流式消息按 sessionId 广播
 * - resend / latest_sequence 消息处理
 * - EventBus 事件监听注册
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockEventBusOn, mockGetMessages, mockGetLatestSequence } = vi.hoisted(() => ({
  mockEventBusOn: vi.fn(),
  mockGetMessages: vi.fn().mockResolvedValue([]),
  mockGetLatestSequence: vi.fn().mockResolvedValue(0)
}))

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ===== Mock eventBus =====
vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: mockEventBusOn,
    off: vi.fn(),
    emit: vi.fn()
  }
}))

// ===== Mock StreamStore =====
vi.mock('@main/ai/streaming/consumers/StreamStore', () => ({
  streamStore: {
    getMessages: mockGetMessages,
    getLatestSequence: mockGetLatestSequence
  }
}))

import { streamChannel } from '../StreamChannel'
import { StreamEventType } from '@main/ai/streaming/types'

// ==================== 辅助 ====================

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createMockHub() {
  return {
    send: vi.fn(),
    broadcast: vi.fn(),
    broadcastIf: vi.fn().mockReturnValue(0),
    forEachClient: vi.fn(),
    clientCount: 1
  }
}

// ==================== 测试 ====================

describe('StreamChannel', () => {
  let hub: ReturnType<typeof createMockHub>

  beforeEach(() => {
    vi.clearAllMocks()
    hub = createMockHub()
  })

  // ===== 基本属性 =====

  describe('基本属性', () => {
    it('prefix 为 stream', () => {
      expect(streamChannel.prefix).toBe('stream')
    })

    it('label 非空', () => {
      expect(streamChannel.label).toBeTruthy()
    })
  })

  // ===== 初始化 =====

  describe('onInit', () => {
    it('注册 EventBus 流式事件监听', () => {
      streamChannel.onInit(hub)

      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.START, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function))
    })
  })

  // ===== 连接 =====

  describe('onConnect', () => {
    it('初始化客户端 sessionIds', () => {
      const meta: Record<string, unknown> = {}
      streamChannel.onConnect!({}, meta)

      expect(meta.sessionIds).toBeInstanceOf(Set)
      expect((meta.sessionIds as Set<string>).size).toBe(0)
    })
  })

  // ===== subscribe =====

  describe('subscribe', () => {
    it('添加 sessionId 到客户端', async () => {
      streamChannel.onInit(hub)
      const meta: Record<string, unknown> = { sessionIds: new Set<string>() }
      const ws = {}

      await streamChannel.onMessage(
        ws,
        'subscribe',
        {
          type: 'stream:subscribe',
          sessionId: 'session-1'
        },
        meta
      )

      expect((meta.sessionIds as Set<string>).has('session-1')).toBe(true)
    })

    it('发送订阅确认消息', async () => {
      streamChannel.onInit(hub)
      const meta: Record<string, unknown> = { sessionIds: new Set<string>() }
      const ws = {}

      await streamChannel.onMessage(
        ws,
        'subscribe',
        {
          type: 'stream:subscribe',
          sessionId: 'session-1'
        },
        meta
      )

      expect(hub.send).toHaveBeenCalledWith(
        ws,
        expect.objectContaining({
          type: 'stream:message',
          data: expect.objectContaining({
            sessionId: 'session-1',
            type: 'text',
            content: expect.stringContaining('session-1')
          })
        })
      )
    })
  })

  // ===== unsubscribe =====

  describe('unsubscribe', () => {
    it('移除 sessionId', async () => {
      streamChannel.onInit(hub)
      const meta: Record<string, unknown> = { sessionIds: new Set(['session-1', 'session-2']) }

      await streamChannel.onMessage(
        {},
        'unsubscribe',
        {
          type: 'stream:unsubscribe',
          sessionId: 'session-1'
        },
        meta
      )

      expect((meta.sessionIds as Set<string>).has('session-1')).toBe(false)
      expect((meta.sessionIds as Set<string>).has('session-2')).toBe(true)
    })
  })

  // ===== resend =====

  describe('resend', () => {
    it('从 StreamStore 获取消息并发送', async () => {
      const mockMessages = [
        {
          id: '1',
          sessionId: 's1',
          sequence: 1,
          type: 'text',
          content: 'hello',
          timestamp: 1,
          source: { type: 'agent', id: 'a1', name: 'A' }
        }
      ]
      mockGetMessages.mockResolvedValueOnce(mockMessages)
      streamChannel.onInit(hub)
      const ws = {}

      await streamChannel.onMessage(
        ws,
        'resend',
        {
          type: 'stream:resend',
          sessionId: 's1',
          fromSequence: 1
        },
        { sessionIds: new Set() }
      )

      expect(mockGetMessages).toHaveBeenCalledWith('s1', 1, 100)
      expect(hub.send).toHaveBeenCalledWith(
        ws,
        expect.objectContaining({
          type: 'stream:resend_batch',
          data: mockMessages
        })
      )
    })
  })

  // ===== latest_sequence =====

  describe('latest_sequence', () => {
    it('返回最新序号', async () => {
      mockGetLatestSequence.mockResolvedValueOnce(42)
      streamChannel.onInit(hub)
      const ws = {}

      await streamChannel.onMessage(
        ws,
        'latest_sequence',
        {
          type: 'stream:latest_sequence',
          sessionId: 's1'
        },
        { sessionIds: new Set() }
      )

      expect(mockGetLatestSequence).toHaveBeenCalledWith('s1')
      expect(hub.send).toHaveBeenCalledWith(ws, {
        type: 'stream:latest_sequence',
        data: { sequence: 42 }
      })
    })
  })

  // ===== EventBus 消息广播 =====

  describe('EventBus → 广播', () => {
    it('stream:message 事件按 sessionId 广播', () => {
      streamChannel.onInit(hub)

      // 获取注册的 MESSAGE 事件处理器
      const messageHandler = mockEventBusOn.mock.calls.find(
        (call: unknown[]) => call[0] === StreamEventType.MESSAGE
      )?.[1] as (event: unknown) => void

      expect(messageHandler).toBeDefined()

      // 模拟 EventBus 发出 stream:message 事件
      const mockMessage = {
        id: 'msg-1',
        sessionId: 'session-1',
        sequence: 1,
        type: 'text',
        content: 'hello',
        timestamp: Date.now(),
        source: { type: 'agent', id: 'a1', name: 'Agent' }
      }

      messageHandler({
        type: StreamEventType.MESSAGE,
        sessionId: 'session-1',
        message: mockMessage,
        timestamp: Date.now()
      })

      expect(hub.broadcastIf).toHaveBeenCalledWith(
        { type: 'stream:message', data: mockMessage },
        expect.any(Function)
      )
    })
  })
})
