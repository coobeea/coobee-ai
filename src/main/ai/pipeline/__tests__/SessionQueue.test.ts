import { describe, expect, it, beforeEach } from 'vitest'

import { SessionQueue } from '../SessionQueue'

describe('SessionQueue', () => {
  let queue: SessionQueue

  beforeEach(() => {
    queue = new SessionQueue('test-session')
  })

  it('should start empty', () => {
    expect(queue.isEmpty()).toBe(true)
    expect(queue.length).toBe(0)
  })

  it('should enqueue and dequeue in FIFO order', () => {
    queue.enqueue('test-session', 'first')
    queue.enqueue('test-session', 'second')
    queue.enqueue('test-session', 'third')

    expect(queue.length).toBe(3)
    expect(queue.dequeue()?.message).toBe('first')
    expect(queue.dequeue()?.message).toBe('second')
    expect(queue.dequeue()?.message).toBe('third')
    expect(queue.isEmpty()).toBe(true)
  })

  it('should peek without removing', () => {
    queue.enqueue('test-session', 'hello')
    expect(queue.peek()?.message).toBe('hello')
    expect(queue.length).toBe(1) // still in queue
  })

  it('should dequeueAll', () => {
    queue.enqueue('test-session', 'a')
    queue.enqueue('test-session', 'b')
    queue.enqueue('test-session', 'c')

    const all = queue.dequeueAll()
    expect(all).toHaveLength(3)
    expect(queue.isEmpty()).toBe(true)
  })

  it('should clear and return count', () => {
    queue.enqueue('test-session', 'a')
    queue.enqueue('test-session', 'b')
    expect(queue.clear()).toBe(2)
    expect(queue.isEmpty()).toBe(true)
  })

  // ─── Drop Policy: old ─────────────────────────

  it('should drop oldest when cap reached (old policy)', () => {
    const q = new SessionQueue('s1', { cap: 2, dropPolicy: 'old' })
    q.enqueue('s1', 'first')
    q.enqueue('s1', 'second')
    q.enqueue('s1', 'third') // should drop 'first'

    expect(q.length).toBe(2)
    expect(q.dequeue()?.message).toBe('second')
    expect(q.dequeue()?.message).toBe('third')
    expect(q.droppedCount).toBe(1)
  })

  // ─── Drop Policy: new ─────────────────────────

  it('should drop new message when cap reached (new policy)', () => {
    const q = new SessionQueue('s1', { cap: 2, dropPolicy: 'new' })
    q.enqueue('s1', 'first')
    q.enqueue('s1', 'second')
    q.enqueue('s1', 'third') // should be dropped

    expect(q.length).toBe(2)
    expect(q.dequeue()?.message).toBe('first')
    expect(q.dequeue()?.message).toBe('second')
    expect(q.droppedCount).toBe(1)
  })

  // ─── Drop Policy: summarize ───────────────────

  it('should summarize oldest when cap reached (summarize policy)', () => {
    const q = new SessionQueue('s1', { cap: 2, dropPolicy: 'summarize' })
    q.enqueue('s1', 'first')
    q.enqueue('s1', 'second')
    q.enqueue('s1', 'third') // 'first' goes to summary

    expect(q.length).toBe(2)
    const state = q.getState()
    expect(state.summaryLines).toContain('first')
    expect(q.droppedCount).toBe(1)
  })

  // ─── Settings ─────────────────────────────────

  it('should use default settings', () => {
    expect(queue.settings.mode).toBe('collect')
    expect(queue.settings.cap).toBe(20)
  })

  it('should allow setting updates', () => {
    queue.setSettings({ mode: 'interrupt', cap: 5 })
    expect(queue.settings.mode).toBe('interrupt')
    expect(queue.settings.cap).toBe(5)
  })

  // ─── State tracking ──────────────────────────

  it('should track isRunning and draining', () => {
    expect(queue.isRunning).toBe(false)
    queue.isRunning = true
    expect(queue.isRunning).toBe(true)

    expect(queue.draining).toBe(false)
    queue.draining = true
    expect(queue.draining).toBe(true)
  })

  it('should return full state snapshot', () => {
    queue.enqueue('test-session', 'msg')
    const state = queue.getState()
    expect(state.sessionId).toBe('test-session')
    expect(state.queue).toHaveLength(1)
    expect(state.isRunning).toBe(false)
  })
})
