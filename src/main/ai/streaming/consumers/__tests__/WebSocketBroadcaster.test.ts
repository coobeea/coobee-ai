/**
 * WebSocketBroadcaster 测试
 *
 * 测试 WebSocket 广播器的核心功能：
 * - 初始化和事件监听注册
 * - 客户端管理（统计）
 * - 消息广播逻辑
 * - 关闭连接
 *
 * 注意：由于 WebSocketServer 的系统级依赖，这里主要测试
 * 不依赖真实 WebSocket 连接的公共方法和统计功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockWssOn, mockWssClose, mockEventBusOn } = vi.hoisted(() => ({
  mockWssOn: vi.fn(),
  mockWssClose: vi.fn(),
  mockEventBusOn: vi.fn()
}))

// ===== Mock ws =====
vi.mock('ws', () => {
  class MockWebSocketServer {
    on = mockWssOn
    close = mockWssClose
  }
  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: {
      OPEN: 1,
      CLOSED: 3
    }
  }
})

// ===== Mock logger (避免 logger → env → electron 依赖) =====
vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ===== Mock env (避免 electron 依赖) =====
vi.mock('@main/common/env', () => ({
  Env: {
    main: { wsPort: '9999' }
  }
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
vi.mock('../StreamStore', () => ({
  streamStore: {
    getMessages: vi.fn().mockResolvedValue([]),
    getLatestSequence: vi.fn().mockResolvedValue(0)
  }
}))

import { WebSocketBroadcaster } from '../WebSocketBroadcaster'
import { StreamEventType } from '../../types'

describe('WebSocketBroadcaster', () => {
  let broadcaster: WebSocketBroadcaster

  beforeEach(() => {
    vi.clearAllMocks()
    broadcaster = new WebSocketBroadcaster()
  })

  // ===== 初始化 =====

  describe('initialize', () => {
    it('创建 WebSocket 服务器', () => {
      broadcaster.initialize(9999)

      // WebSocketServer 被实例化
      expect(mockWssOn).toHaveBeenCalledWith('connection', expect.any(Function))
    })

    it('注册 EventBus 事件监听', () => {
      broadcaster.initialize(9999)

      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.START, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function))
      expect(mockEventBusOn).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function))
    })

    it('重复初始化不产生副作用', () => {
      broadcaster.initialize(9999)
      const callCount = mockWssOn.mock.calls.length

      broadcaster.initialize(9999)
      expect(mockWssOn.mock.calls.length).toBe(callCount)
    })
  })

  // ===== 统计 =====

  describe('getClientCount', () => {
    it('初始状态无客户端', () => {
      expect(broadcaster.getClientCount()).toBe(0)
    })
  })

  describe('getSessionClientCount', () => {
    it('无订阅时返回 0', () => {
      expect(broadcaster.getSessionClientCount('session-1')).toBe(0)
    })
  })

  describe('getStats', () => {
    it('返回统计信息', () => {
      const stats = broadcaster.getStats()

      expect(stats.totalClients).toBe(0)
      expect(stats.sessions).toEqual({})
    })
  })

  // ===== 关闭 =====

  describe('close', () => {
    it('关闭所有连接和服务器', () => {
      broadcaster.initialize(9999)
      broadcaster.close()

      expect(mockWssClose).toHaveBeenCalledOnce()
      expect(broadcaster.getClientCount()).toBe(0)
    })
  })
})
