/**
 * streamChannelManager.ts 单元测试
 *
 * 测试目标：流通道管理器、HTTP/IPC 通道生命周期
 * - 通道创建 / 删除
 * - 心跳机制
 * - 过期检测
 * - 窗口监听器管理
 * - abort / signal 机制
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

// ==================== Mock 依赖 ====================

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeListener: vi.fn()
  },
  BrowserWindow: vi.fn(),
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    getName: () => 'test',
    getVersion: () => '0.0.0',
    getLocale: () => 'zh-CN',
    isPackaged: false
  }
}))

// 重新导入以获取被 mock 的模块
// 注意：streamChannelManager 是单例，需要特殊处理
// 我们直接测试其公共 API

import { streamChannelManager } from '../streamChannelManager'

// ==================== 辅助 ====================

function createMockResponse(): {
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
} {
  return {
    write: vi.fn(),
    end: vi.fn(),
    once: vi.fn()
  }
}

function createMockWindow(): {
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  webContents: {
    send: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    removeListener: ReturnType<typeof vi.fn>
  }
} {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
}

// ==================== HTTP 通道测试 ====================

describe('StreamChannelManager - HTTP 通道', () => {
  afterEach(() => {
    // 清理所有通道避免干扰下个测试
    streamChannelManager.shutdown()
  })

  it('创建 HTTP 通道成功', () => {
    const response = createMockResponse()
    const channel = streamChannelManager.createChannel({
      streamId: 'http-1',
      type: 'http',
      response
    })

    expect(channel).toBeDefined()
    expect(typeof channel.write).toBe('function')
    expect(typeof channel.end).toBe('function')
    expect(typeof channel.getSignal).toBe('function')
    expect(typeof channel.abort).toBe('function')

    const stats = streamChannelManager.getStats()
    expect(stats.total).toBeGreaterThanOrEqual(1)
    expect(stats.http).toBeGreaterThanOrEqual(1)
  })

  it('HTTP 通道缺少 response 时抛出异常', () => {
    expect(() =>
      streamChannelManager.createChannel({
        streamId: 'http-fail',
        type: 'http'
      })
    ).toThrow('HTTP channel requires response parameter')
  })

  it('HTTP 通道 write 写入 SSE 格式', () => {
    const response = createMockResponse()
    const channel = streamChannelManager.createChannel({
      streamId: 'http-write',
      type: 'http',
      response
    })

    channel.write({ type: 'data', data: 'hello', timestamp: Date.now() })

    expect(response.write).toHaveBeenCalledTimes(1)
    const written = response.write.mock.calls[0][0] as string
    expect(written).toContain('data:')
    expect(written).toContain('"type":"data"')
    expect(written).toContain('"hello"')
  })

  it('HTTP 通道 end 后 write 无效', () => {
    const response = createMockResponse()
    const channel = streamChannelManager.createChannel({
      streamId: 'http-end',
      type: 'http',
      response
    })

    channel.end()
    channel.write({ type: 'data', timestamp: Date.now() })

    // end 前 response.end 应被调用, end 后 write 不会调用 response.write
    expect(response.end).toHaveBeenCalled()
    // write 在 end 之后不会再写入
    expect(response.write).not.toHaveBeenCalled()
  })

  it('HTTP 通道 getSignal 返回 AbortSignal', () => {
    const response = createMockResponse()
    const channel = streamChannelManager.createChannel({
      streamId: 'http-signal',
      type: 'http',
      response
    })

    const signal = channel.getSignal()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('HTTP 通道 abort 后 signal.aborted = true', () => {
    const response = createMockResponse()
    const channel = streamChannelManager.createChannel({
      streamId: 'http-abort',
      type: 'http',
      response
    })

    const signal = channel.getSignal()
    channel.abort('test-reason')

    expect(signal.aborted).toBe(true)
  })
})

// ==================== IPC 通道测试 ====================

describe('StreamChannelManager - IPC 通道', () => {
  afterEach(() => {
    streamChannelManager.shutdown()
  })

  it('创建 IPC 通道成功', () => {
    const window = createMockWindow()
    const channel = streamChannelManager.createChannel({
      streamId: 'ipc-1',
      type: 'ipc',
      streamChannel: 'sse_ipc-1',
      window
    })

    expect(channel).toBeDefined()
    expect(typeof channel.write).toBe('function')

    const stats = streamChannelManager.getStats()
    expect(stats.ipc).toBeGreaterThanOrEqual(1)
  })

  it('IPC 通道缺少 streamChannel 时抛出异常', () => {
    expect(() =>
      streamChannelManager.createChannel({
        streamId: 'ipc-fail-1',
        type: 'ipc',
        window: createMockWindow()
      })
    ).toThrow('IPC channel requires streamChannel and window parameters')
  })

  it('IPC 通道缺少 window 时抛出异常', () => {
    expect(() =>
      streamChannelManager.createChannel({
        streamId: 'ipc-fail-2',
        type: 'ipc',
        streamChannel: 'sse_ipc-fail-2'
      })
    ).toThrow('IPC channel requires streamChannel and window parameters')
  })

  it('IPC 通道 write 通过 webContents.send 发送', () => {
    const window = createMockWindow()
    const channel = streamChannelManager.createChannel({
      streamId: 'ipc-write',
      type: 'ipc',
      streamChannel: 'sse_ipc-write',
      window
    })

    channel.write({ type: 'data', data: 'ipc-hello', timestamp: Date.now() })

    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    const args = window.webContents.send.mock.calls[0]
    expect(args[0]).toBe('sse_ipc-write')
    expect(args[1]).toMatchObject({
      type: 'data',
      data: 'ipc-hello',
      streamId: 'ipc-write'
    })
  })

  it('IPC 通道 end 后 write 无效', () => {
    const window = createMockWindow()
    const channel = streamChannelManager.createChannel({
      streamId: 'ipc-end',
      type: 'ipc',
      streamChannel: 'sse_ipc-end',
      window
    })

    channel.end()
    channel.write({ type: 'data', timestamp: Date.now() })

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('IPC 通道 abort 后 signal 标记为 aborted', () => {
    const window = createMockWindow()
    const channel = streamChannelManager.createChannel({
      streamId: 'ipc-abort',
      type: 'ipc',
      streamChannel: 'sse_ipc-abort',
      window
    })

    const signal = channel.getSignal()
    expect(signal.aborted).toBe(false)

    channel.abort('user cancelled')
    expect(signal.aborted).toBe(true)
  })
})

// ==================== 管理器公共方法测试 ====================

describe('StreamChannelManager - 管理功能', () => {
  afterEach(() => {
    streamChannelManager.shutdown()
  })

  it('updateDataSent 更新通道数据', () => {
    const response = createMockResponse()
    streamChannelManager.createChannel({
      streamId: 'mgr-update',
      type: 'http',
      response
    })

    // 不抛异常即成功
    streamChannelManager.updateDataSent('mgr-update')
  })

  it('updateDataSent 对不存在的 id 无副作用', () => {
    // 不抛异常
    streamChannelManager.updateDataSent('non-existent-id')
  })

  it('removeChannel 移除通道', () => {
    const response = createMockResponse()
    streamChannelManager.createChannel({
      streamId: 'mgr-remove',
      type: 'http',
      response
    })

    const statsBefore = streamChannelManager.getStats()
    const countBefore = statsBefore.total

    streamChannelManager.removeChannel('mgr-remove')

    const statsAfter = streamChannelManager.getStats()
    expect(statsAfter.total).toBe(countBefore - 1)
  })

  it('removeChannel 对不存在的 id 无副作用', () => {
    streamChannelManager.removeChannel('does-not-exist')
  })

  it('isChannelStale 不存在的通道返回 true', () => {
    expect(streamChannelManager.isChannelStale('not-here')).toBe(true)
  })

  it('isChannelStale 新建通道返回 false', () => {
    const response = createMockResponse()
    streamChannelManager.createChannel({
      streamId: 'mgr-stale-check',
      type: 'http',
      response
    })

    expect(streamChannelManager.isChannelStale('mgr-stale-check')).toBe(false)
  })

  it('updateHeartbeatReply 更新心跳回复', () => {
    const response = createMockResponse()
    streamChannelManager.createChannel({
      streamId: 'mgr-heartbeat',
      type: 'http',
      response
    })

    // 不抛异常即成功
    streamChannelManager.updateHeartbeatReply('mgr-heartbeat')
  })

  it('getStats 返回正确的统计', () => {
    const response1 = createMockResponse()
    const response2 = createMockResponse()
    const window1 = createMockWindow()

    streamChannelManager.createChannel({
      streamId: 'stat-http-1',
      type: 'http',
      response: response1
    })
    streamChannelManager.createChannel({
      streamId: 'stat-http-2',
      type: 'http',
      response: response2
    })
    streamChannelManager.createChannel({
      streamId: 'stat-ipc-1',
      type: 'ipc',
      streamChannel: 'sse_stat-ipc-1',
      window: window1
    })

    const stats = streamChannelManager.getStats()
    expect(stats.total).toBeGreaterThanOrEqual(3)
    expect(stats.http).toBeGreaterThanOrEqual(2)
    expect(stats.ipc).toBeGreaterThanOrEqual(1)
    expect(stats.channels).toContain('stat-http-1')
    expect(stats.channels).toContain('stat-http-2')
    expect(stats.channels).toContain('stat-ipc-1')
  })

  it('shutdown 清空所有通道', () => {
    const response = createMockResponse()
    streamChannelManager.createChannel({ streamId: 'shutdown-1', type: 'http', response })

    streamChannelManager.shutdown()

    const stats = streamChannelManager.getStats()
    expect(stats.total).toBe(0)
  })
})
