/**
 * SwarmContext 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SwarmContext } from '../SwarmContext'

describe('SwarmContext', () => {
  let ctx: SwarmContext

  beforeEach(() => {
    ctx = new SwarmContext()
  })

  describe('状态读写', () => {
    it('set/get', () => {
      ctx.set('k', 'v', 'agent')
      expect(ctx.get('k')).toBe('v')
    })

    it('get 不存在返回 undefined', () => {
      expect(ctx.get('nope')).toBeUndefined()
    })

    it('has', () => {
      ctx.set('x', 1, 'sys')
      expect(ctx.has('x')).toBe(true)
      expect(ctx.has('y')).toBe(false)
    })

    it('delete', () => {
      ctx.set('k', 'v', 'sys')
      expect(ctx.delete('k', 'sys')).toBe(true)
      expect(ctx.get('k')).toBeUndefined()
    })

    it('delete 不存在返回 false', () => {
      expect(ctx.delete('nope')).toBe(false)
    })

    it('keys', () => {
      ctx.set('a', 1, 'sys')
      ctx.set('b', 2, 'sys')
      expect(ctx.keys()).toEqual(['a', 'b'])
    })

    it('getState 返回副本', () => {
      ctx.set('x', 'y', 'sys')
      const state = ctx.getState()
      state.x = 'modified'
      expect(ctx.get('x')).toBe('y')
    })
  })

  describe('产物管理', () => {
    it('addArtifact', () => {
      ctx.addArtifact('doc', 'content', 'writer', 'document')
      const a = ctx.getArtifact('doc')
      expect(a).toBeDefined()
      expect(a!.content).toBe('content')
      expect(a!.createdBy).toBe('writer')
    })

    it('getArtifact 返回最新', () => {
      ctx.addArtifact('doc', 'v1', 'w')
      ctx.addArtifact('doc', 'v2', 'w')
      expect(ctx.getArtifact('doc')!.content).toBe('v2')
    })

    it('getArtifact 不存在', () => {
      expect(ctx.getArtifact('nope')).toBeUndefined()
    })

    it('getArtifactsByRole', () => {
      ctx.addArtifact('a', 'a', 'coder')
      ctx.addArtifact('b', 'b', 'reviewer')
      ctx.addArtifact('c', 'c', 'coder')
      expect(ctx.getArtifactsByRole('coder')).toHaveLength(2)
    })

    it('getArtifactsByType', () => {
      ctx.addArtifact('a', 'a', 'r', 'code')
      ctx.addArtifact('b', 'b', 'r', 'doc')
      ctx.addArtifact('c', 'c', 'r', 'code')
      expect(ctx.getArtifactsByType('code')).toHaveLength(2)
    })
  })

  describe('进度跟踪', () => {
    it('addProgressNote', () => {
      ctx.addProgressNote('Step 1', 'worker')
      const notes = ctx.getProgressNotes()
      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain('Step 1')
    })

    it('getRecentProgress', () => {
      for (let i = 1; i <= 10; i++) ctx.addProgressNote(`S${i}`, 'w')
      expect(ctx.getRecentProgress(3)).toHaveLength(3)
    })
  })

  describe('序列化', () => {
    it('toSummary', () => {
      ctx.set('goal', 'test', 'sys')
      ctx.addArtifact('code', 'x=1', 'coder', 'code')
      const summary = ctx.toSummary()
      expect(summary).toContain('goal')
      expect(summary).toContain('code')
    })

    it('export/import', () => {
      ctx.set('a', 1, 'sys')
      ctx.addArtifact('doc', 'text', 'w')
      const data = ctx.export()
      const newCtx = new SwarmContext()
      newCtx.import(data)
      expect(newCtx.get('a')).toBe(1)
      expect(newCtx.getArtifacts()).toHaveLength(1)
    })
  })

  describe('事件系统', () => {
    it('变更触发监听器', () => {
      const listener = vi.fn()
      ctx.addChangeListener(listener)
      ctx.set('k', 'v', 'agent')
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state_set', key: 'k' })
      )
    })

    it('removeChangeListener', () => {
      const listener = vi.fn()
      ctx.addChangeListener(listener)
      ctx.removeChangeListener(listener)
      ctx.set('k', 'v', 'agent')
      expect(listener).not.toHaveBeenCalled()
    })

    it('getChangeHistory', () => {
      ctx.set('a', 1, 'sys')
      ctx.delete('a', 'sys')
      expect(ctx.getChangeHistory()).toHaveLength(2)
    })
  })

  describe('清理', () => {
    it('clear', () => {
      ctx.set('a', 1, 'sys')
      ctx.clear()
      expect(ctx.keys()).toHaveLength(0)
    })

    it('destroy', () => {
      const listener = vi.fn()
      ctx.addChangeListener(listener)
      ctx.destroy()
      ctx.set('a', 1, 'sys')
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
