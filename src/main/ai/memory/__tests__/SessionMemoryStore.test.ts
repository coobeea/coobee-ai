/**
 * SessionMemoryStore 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionMemoryStore } from '../SessionMemoryStore'

describe('SessionMemoryStore', () => {
  let store: SessionMemoryStore
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = []

  const mockSessionManager = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appendMessage: vi.fn(async (msg: any) => {
      messages.push(msg)
    }),
    readMessages: vi.fn(async () => [...messages])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  beforeEach(() => {
    messages.length = 0
    vi.clearAllMocks()
    store = new SessionMemoryStore(mockSessionManager, 'session-1')
  })

  it('initialize 不抛出错误', async () => {
    await expect(store.initialize()).resolves.not.toThrow()
  })

  it('appendMessage 追加消息', async () => {
    await store.appendMessage({ role: 'user', content: 'hello' })

    expect(mockSessionManager.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hello' })
    )
  })

  it('appendMessage 自动填充 timestamp', async () => {
    await store.appendMessage({ role: 'user', content: 'test' })

    expect(mockSessionManager.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(Number) })
    )
  })

  it('appendMessages 批量追加', async () => {
    await store.appendMessages([
      { role: 'user', content: 'a', timestamp: 1 },
      { role: 'assistant', content: 'b', timestamp: 2 }
    ])

    expect(mockSessionManager.appendMessage).toHaveBeenCalledTimes(2)
  })

  it('getHistory 返回全部历史', async () => {
    messages.push(
      { role: 'user', content: 'a', timestamp: 1 },
      { role: 'assistant', content: 'b', timestamp: 2 }
    )

    const history = await store.getHistory()
    expect(history).toHaveLength(2)
  })

  it('getHistory 带 limit', async () => {
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: `msg-${i}`, timestamp: i })
    }

    const history = await store.getHistory(3)
    expect(history).toHaveLength(3)
  })

  it('getMessagesByRole 过滤角色', async () => {
    messages.push(
      { role: 'user', content: 'u1', timestamp: 1 },
      { role: 'assistant', content: 'a1', timestamp: 2 },
      { role: 'user', content: 'u2', timestamp: 3 }
    )

    const userMsgs = await store.getMessagesByRole('user')
    expect(userMsgs).toHaveLength(2)
  })

  it('getStats 返回统计', async () => {
    messages.push(
      { role: 'user', content: 'u', timestamp: 100 },
      { role: 'assistant', content: 'a', timestamp: 200 }
    )

    const stats = await store.getStats()
    expect(stats.total).toBe(2)
    expect(stats.byRole['user']).toBe(1)
    expect(stats.timeRange!.start).toBe(100)
  })

  it('getStats 空消息返回空统计', async () => {
    const stats = await store.getStats()
    expect(stats.total).toBe(0)
    expect(stats.timeRange).toBeNull()
  })
})
