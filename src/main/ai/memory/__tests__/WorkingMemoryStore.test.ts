/**
 * WorkingMemoryStore 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkingMemoryStore } from '../WorkingMemoryStore'

describe('WorkingMemoryStore', () => {
  let store: WorkingMemoryStore

  const mockSessionManager = {
    readSharedContext: vi.fn().mockResolvedValue(null),
    writeSharedContext: vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    store = new WorkingMemoryStore(mockSessionManager, 'session-1')
  })

  describe('变量管理', () => {
    it('setVariable / getVariable', async () => {
      await store.setVariable('key', 'value')
      expect(store.getVariable('key')).toBe('value')
    })

    it('setVariables 批量设置', async () => {
      await store.setVariables({ a: 1, b: 2 })
      expect(store.getVariable('a')).toBe(1)
      expect(store.getVariable('b')).toBe(2)
    })

    it('deleteVariable', async () => {
      await store.setVariable('k', 'v')
      await store.deleteVariable('k')
      expect(store.getVariable('k')).toBeUndefined()
    })

    it('getAllVariables 返回副本', async () => {
      await store.setVariable('x', 1)
      const vars = store.getAllVariables()
      expect(vars.x).toBe(1)
    })

    it('每次变更持久化', async () => {
      await store.setVariable('k', 'v')
      expect(mockSessionManager.writeSharedContext).toHaveBeenCalled()
    })
  })

  describe('计划状态', () => {
    it('setCurrentPlan / getCurrentPlan', async () => {
      await store.setCurrentPlan({ planVersion: 1, totalSubTasks: 5, completedSubTasks: 0 })
      const plan = store.getCurrentPlan()
      expect(plan!.totalSubTasks).toBe(5)
    })

    it('updatePlanProgress', async () => {
      await store.setCurrentPlan({ planVersion: 1, totalSubTasks: 5, completedSubTasks: 0 })
      await store.updatePlanProgress(3)
      expect(store.getCurrentPlan()!.completedSubTasks).toBe(3)
    })

    it('clearCurrentPlan', async () => {
      await store.setCurrentPlan({ planVersion: 1, totalSubTasks: 5, completedSubTasks: 0 })
      await store.clearCurrentPlan()
      expect(store.getCurrentPlan()).toBeUndefined()
    })
  })

  describe('子任务状态', () => {
    it('addPendingSubtasks', async () => {
      await store.addPendingSubtasks(['t1', 't2'])
      const status = store.getSubtaskStatus()
      expect(status.pending).toEqual(['t1', 't2'])
    })

    it('不重复添加', async () => {
      await store.addPendingSubtasks(['t1'])
      await store.addPendingSubtasks(['t1'])
      expect(store.getSubtaskStatus().pending).toEqual(['t1'])
    })

    it('markSubtaskCompleted', async () => {
      await store.addPendingSubtasks(['t1', 't2'])
      await store.markSubtaskCompleted('t1')

      const status = store.getSubtaskStatus()
      expect(status.completed).toContain('t1')
      expect(status.pending).not.toContain('t1')
    })

    it('markSubtaskFailed', async () => {
      await store.addPendingSubtasks(['t1'])
      await store.markSubtaskFailed('t1')

      const status = store.getSubtaskStatus()
      expect(status.failed).toContain('t1')
      expect(status.pending).not.toContain('t1')
    })

    it('clearSubtaskStatus', async () => {
      await store.addPendingSubtasks(['t1'])
      await store.markSubtaskCompleted('t1')
      await store.clearSubtaskStatus()

      const status = store.getSubtaskStatus()
      expect(status.total).toBe(0)
    })
  })

  describe('检查点', () => {
    it('createCheckpoint 返回 ID', async () => {
      const id = await store.createCheckpoint()
      expect(id).toContain('checkpoint-')
    })

    it('listCheckpoints', async () => {
      await store.createCheckpoint()
      await store.createCheckpoint()
      expect(store.listCheckpoints()).toHaveLength(2)
    })

    it('deleteCheckpoint', async () => {
      const id = await store.createCheckpoint()
      const result = await store.deleteCheckpoint(id)
      expect(result).toBe(true)
      expect(store.listCheckpoints()).toHaveLength(0)
    })

    it('deleteCheckpoint 不存在返回 false', async () => {
      const result = await store.deleteCheckpoint('nope')
      expect(result).toBe(false)
    })
  })

  describe('清理', () => {
    it('clearState', async () => {
      await store.setVariable('k', 'v')
      await store.addPendingSubtasks(['t1'])
      await store.clearState()

      expect(store.getAllVariables()).toEqual({})
      expect(store.getSubtaskStatus().total).toBe(0)
    })

    it('getState 返回只读副本', () => {
      const state = store.getState()
      expect(state.sessionId).toBe('session-1')
    })
  })
})
