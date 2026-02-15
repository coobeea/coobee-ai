import { describe, expect, it, vi } from 'vitest'

import { buildCollectPrompt, drainCollect, drainFollowup } from '../DrainStrategy'
import { SessionQueue } from '../SessionQueue'

describe('DrainStrategy', () => {
  describe('drainFollowup', () => {
    it('should execute each message in order', async () => {
      const queue = new SessionQueue('s1')
      queue.enqueue('s1', 'first')
      queue.enqueue('s1', 'second')
      queue.enqueue('s1', 'third')

      const executed: string[] = []
      const executor = vi.fn(async (_sid: string, msg: string) => {
        executed.push(msg)
      })

      const count = await drainFollowup(queue, executor)

      expect(count).toBe(3)
      expect(executed).toEqual(['first', 'second', 'third'])
      expect(queue.isEmpty()).toBe(true)
    })

    it('should return 0 for empty queue', async () => {
      const queue = new SessionQueue('s1')
      const count = await drainFollowup(queue, vi.fn())
      expect(count).toBe(0)
    })
  })

  describe('drainCollect', () => {
    it('should merge all messages and execute once', async () => {
      const queue = new SessionQueue('s1')
      queue.enqueue('s1', 'fix bug A')
      queue.enqueue('s1', 'also fix bug B')

      let executedMsg = ''
      const executor = vi.fn(async (_sid: string, msg: string) => {
        executedMsg = msg
      })

      const count = await drainCollect(queue, executor)

      expect(count).toBe(2)
      expect(executor).toHaveBeenCalledTimes(1)
      expect(executedMsg).toContain('fix bug A')
      expect(executedMsg).toContain('also fix bug B')
    })

    it('should pass single message directly', async () => {
      const queue = new SessionQueue('s1')
      queue.enqueue('s1', 'just one')

      let executedMsg = ''
      const executor = vi.fn(async (_sid: string, msg: string) => {
        executedMsg = msg
      })

      await drainCollect(queue, executor)
      expect(executedMsg).toBe('just one')
    })

    it('should return 0 for empty queue', async () => {
      const queue = new SessionQueue('s1')
      const count = await drainCollect(queue, vi.fn())
      expect(count).toBe(0)
    })
  })

  describe('buildCollectPrompt', () => {
    it('should return single message as-is', () => {
      const msgs = [{ id: '1', sessionId: 's1', message: 'hello', enqueuedAt: 0 }]
      expect(buildCollectPrompt(msgs)).toBe('hello')
    })

    it('should format multiple messages with numbered list', () => {
      const msgs = [
        { id: '1', sessionId: 's1', message: 'do X', enqueuedAt: 0 },
        { id: '2', sessionId: 's1', message: 'do Y', enqueuedAt: 1 }
      ]
      const result = buildCollectPrompt(msgs)
      expect(result).toContain('[1] do X')
      expect(result).toContain('[2] do Y')
      expect(result).toContain('2 条新消息')
    })
  })
})
