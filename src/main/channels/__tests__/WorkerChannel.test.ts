/**
 * WorkerChannel 测试
 *
 * 测试 Worker 管理频道：
 * - list / start / stop 消息处理
 * - RuntimeManager 事件监听
 * - worker:status 广播
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Hoisted mocks =====
const { mockRuntimeOn, mockRuntimeStart, mockRuntimeStop, mockRuntimeGetAll } = vi.hoisted(() => ({
  mockRuntimeOn: vi.fn(),
  mockRuntimeStart: vi.fn().mockResolvedValue(undefined),
  mockRuntimeStop: vi.fn().mockResolvedValue(undefined),
  mockRuntimeGetAll: vi.fn().mockReturnValue([])
}))

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ===== Mock RuntimeManager =====
vi.mock('@main/runtime', () => ({
  RuntimeManager: {
    getInstance: vi.fn(() => ({
      on: mockRuntimeOn,
      start: mockRuntimeStart,
      stop: mockRuntimeStop,
      getAllWorkerInfo: mockRuntimeGetAll
    }))
  }
}))

import { workerChannel } from '../WorkerChannel'
import type { WorkerStatusInfo } from '@shared/stream-protocol'

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

function createWorkerInfo(name: string, status: string): WorkerStatusInfo {
  return {
    name,
    label: `${name} Worker`,
    status: status as WorkerStatusInfo['status'],
    port: status === 'ready' ? 18200 : undefined,
    restartCount: 0
  }
}

// ==================== 测试 ====================

describe('WorkerChannel', () => {
  let hub: ReturnType<typeof createMockHub>

  beforeEach(() => {
    vi.clearAllMocks()
    hub = createMockHub()
  })

  // ===== 基本属性 =====

  describe('基本属性', () => {
    it('prefix 为 worker', () => {
      expect(workerChannel.prefix).toBe('worker')
    })

    it('label 非空', () => {
      expect(workerChannel.label).toBeTruthy()
    })
  })

  // ===== 初始化 =====

  describe('onInit', () => {
    it('注册 RuntimeManager worker:status 监听', () => {
      workerChannel.onInit(hub)

      expect(mockRuntimeOn).toHaveBeenCalledWith('worker:status', expect.any(Function))
    })
  })

  // ===== list =====

  describe('worker:list', () => {
    it('返回所有 Worker 状态', async () => {
      const workers = [createWorkerInfo('whisper-asr', 'ready'), createWorkerInfo('tts', 'stopped')]
      mockRuntimeGetAll.mockReturnValueOnce(workers)
      workerChannel.onInit(hub)

      const ws = {}
      await workerChannel.onMessage(ws, 'list', { type: 'worker:list' }, {})

      expect(hub.send).toHaveBeenCalledWith(ws, {
        type: 'worker:list',
        data: workers
      })
    })

    it('空 Worker 列表返回空数组', async () => {
      mockRuntimeGetAll.mockReturnValueOnce([])
      workerChannel.onInit(hub)

      const ws = {}
      await workerChannel.onMessage(ws, 'list', { type: 'worker:list' }, {})

      expect(hub.send).toHaveBeenCalledWith(ws, {
        type: 'worker:list',
        data: []
      })
    })
  })

  // ===== start =====

  describe('worker:start', () => {
    it('调用 RuntimeManager.start', async () => {
      workerChannel.onInit(hub)

      await workerChannel.onMessage(
        {},
        'start',
        {
          type: 'worker:start',
          workerName: 'whisper-asr'
        },
        {}
      )

      expect(mockRuntimeStart).toHaveBeenCalledWith('whisper-asr')
    })

    it('缺少 workerName 不调用 start', async () => {
      workerChannel.onInit(hub)

      await workerChannel.onMessage(
        {},
        'start',
        {
          type: 'worker:start'
        },
        {}
      )

      expect(mockRuntimeStart).not.toHaveBeenCalled()
    })
  })

  // ===== stop =====

  describe('worker:stop', () => {
    it('调用 RuntimeManager.stop', async () => {
      workerChannel.onInit(hub)

      await workerChannel.onMessage(
        {},
        'stop',
        {
          type: 'worker:stop',
          workerName: 'whisper-asr'
        },
        {}
      )

      expect(mockRuntimeStop).toHaveBeenCalledWith('whisper-asr')
    })

    it('缺少 workerName 不调用 stop', async () => {
      workerChannel.onInit(hub)

      await workerChannel.onMessage(
        {},
        'stop',
        {
          type: 'worker:stop'
        },
        {}
      )

      expect(mockRuntimeStop).not.toHaveBeenCalled()
    })
  })

  // ===== RuntimeManager 事件 → 广播 =====

  describe('worker:status 广播', () => {
    it('Worker 状态变更广播给所有客户端', () => {
      workerChannel.onInit(hub)

      // 获取注册的 worker:status 事件处理器
      const statusHandler = mockRuntimeOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'worker:status'
      )?.[1] as (event: { worker: WorkerStatusInfo }) => void

      expect(statusHandler).toBeDefined()

      // 模拟 RuntimeManager 发出 worker:status 事件
      const workerInfo = createWorkerInfo('whisper-asr', 'ready')
      statusHandler({ worker: workerInfo })

      expect(hub.broadcast).toHaveBeenCalledWith({
        type: 'worker:status',
        data: workerInfo
      })
    })
  })
})
