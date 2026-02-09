/**
 * HandoffRouter 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@openai/agents', () => ({
  Agent: class MockAgent {
    name: string
    constructor(config: Record<string, unknown>) {
      this.name = (config.name as string) || 'mock'
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handoff: vi.fn((agent: any, opts?: any) => ({
    type: 'handoff',
    agent,
    ...opts
  }))
}))

import { HandoffRouter } from '../HandoffRouter'
import { handoff, Agent } from '@openai/agents'
import type { SwarmConfig, AgentRole } from '../types'

const mockConfig: SwarmConfig = {
  id: 'swarm-test',
  name: 'Test Swarm',
  maxConcurrentAgents: 5,
  agentIdleTimeout: 60000,
  maxHandoffDepth: 3,
  enableSharedContext: true,
  enableMonitoring: true
}

function makeRole(id: string, name?: string): AgentRole {
  return {
    id,
    name: name || id,
    description: `Role ${id}`,
    instructions: `Instructions for ${id}`,
    handoffDescription: `Transfer to ${name || id}`,
    capabilities: []
  }
}

describe('HandoffRouter', () => {
  let router: HandoffRouter

  beforeEach(() => {
    router = new HandoffRouter(mockConfig)
    vi.clearAllMocks()
  })

  describe('buildHandoffs', () => {
    it('构建 handoff 配置', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agents = new Map<string, any>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agents.set('coder', new Agent({ name: 'Coder' } as any))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agents.set('reviewer', new Agent({ name: 'Reviewer' } as any))
      const roles = new Map<string, AgentRole>()
      roles.set('coder', makeRole('coder', 'Coder'))
      roles.set('reviewer', makeRole('reviewer', 'Reviewer'))

      const result = router.buildHandoffs('coder', agents, roles)
      expect(result).toHaveLength(1)
      expect(handoff).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toolNameOverride: 'transfer_to_reviewer' })
      )
    })

    it('排除自身', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agents = new Map<string, any>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agents.set('a', new Agent({ name: 'A' } as any))
      const roles = new Map<string, AgentRole>()
      roles.set('a', makeRole('a'))

      expect(router.buildHandoffs('a', agents, roles)).toHaveLength(0)
    })
  })

  describe('recordHandoff', () => {
    it('记录事件', () => {
      const record = router.recordHandoff('a', 'b')
      expect(record.fromRoleId).toBe('a')
      expect(record.toRoleId).toBe('b')
      expect(record.depth).toBe(1)
    })

    it('递增深度', () => {
      router.recordHandoff('a', 'b')
      const second = router.recordHandoff('b', 'c')
      expect(second.depth).toBe(2)
    })

    it('触发回调', () => {
      const cb = vi.fn()
      router.setOnHandoff(cb)
      router.recordHandoff('a', 'b', { x: 1 })
      expect(cb).toHaveBeenCalledWith('a', 'b', { x: 1 })
    })
  })

  describe('wouldCauseLoop', () => {
    it('检测循环', () => {
      router.recordHandoff('a', 'b')
      router.recordHandoff('b', 'c')
      expect(router.wouldCauseLoop('b')).toBe(true)
    })

    it('无循环', () => {
      router.recordHandoff('a', 'b')
      expect(router.wouldCauseLoop('c')).toBe(false)
    })

    it('resetChain 重置', () => {
      router.recordHandoff('a', 'b')
      router.resetChain()
      expect(router.wouldCauseLoop('b')).toBe(false)
    })
  })

  describe('isMaxDepthReached', () => {
    it('达到最大深度', () => {
      router.recordHandoff('a', 'b')
      router.recordHandoff('b', 'c')
      router.recordHandoff('c', 'd')
      expect(router.isMaxDepthReached()).toBe(true)
    })

    it('未达到最大深度', () => {
      router.recordHandoff('a', 'b')
      expect(router.isMaxDepthReached()).toBe(false)
    })
  })

  describe('历史查询', () => {
    it('getHistoryByRole from', () => {
      router.recordHandoff('a', 'b')
      router.recordHandoff('a', 'c')
      expect(router.getHistoryByRole('a', 'from')).toHaveLength(2)
    })

    it('getStats', () => {
      router.recordHandoff('a', 'b')
      router.recordHandoff('b', 'c')
      const stats = router.getStats()
      expect(stats.totalHandoffs).toBe(2)
      expect(stats.currentDepth).toBe(2)
    })
  })

  describe('清理', () => {
    it('clearHistory', () => {
      router.recordHandoff('a', 'b')
      router.clearHistory()
      expect(router.getHistory()).toHaveLength(0)
      expect(router.getCurrentDepth()).toBe(0)
    })

    it('destroy', () => {
      router.recordHandoff('a', 'b')
      router.destroy()
      expect(router.getHistory()).toHaveLength(0)
    })
  })
})
