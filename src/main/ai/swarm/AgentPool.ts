/**
 * AgentPool - 动态 Agent 池
 *
 * 管理 Agent 实例的创建、复用和退休：
 * - 按角色按需创建 Agent
 * - 空闲 Agent 自动复用
 * - 超时自动退休
 * - 池大小限制 + LRU 淘汰
 * - 性能追踪（执行次数、成功率）
 */

import { Agent } from '@openai/agents'
import { agentFactory } from '../agents/AgentFactory'
import type { AgentRole, PoolAgentEntry, SwarmConfig } from './types'

/**
 * Agent 池事件类型
 */
export type AgentPoolEvent =
  | { type: 'agent_created'; poolId: string; roleId: string }
  | { type: 'agent_acquired'; poolId: string; roleId: string }
  | { type: 'agent_released'; poolId: string; roleId: string }
  | { type: 'agent_retired'; poolId: string; roleId: string; reason: string }

/**
 * Agent 池事件监听器
 */
export type AgentPoolEventListener = (event: AgentPoolEvent) => void

/**
 * 动态 Agent 池
 */
export class AgentPool {
  /** Agent 池：poolId -> PoolAgentEntry */
  private pool = new Map<string, PoolAgentEntry>()

  /** Agent 创建计数器（用于生成唯一 ID） */
  private createCounter = 0

  /** 已退休的 Agent 计数 */
  private retiredCount = 0

  /** 清理定时器 */
  private cleanupTimer: NodeJS.Timeout | null = null

  /** 事件监听器 */
  private eventListeners: AgentPoolEventListener[] = []

  constructor(private readonly config: SwarmConfig) {}

  // ========== 生命周期 ==========

  /**
   * 启动 Agent 池（开始定期清理）
   */
  start(): void {
    if (this.cleanupTimer) {
      return
    }

    // 每分钟检查一次空闲超时
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleAgents()
    }, 60 * 1000)

    console.log('[AgentPool] Started with config:', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      agentIdleTimeout: this.config.agentIdleTimeout
    })
  }

  /**
   * 停止 Agent 池并清理所有资源
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    // 退休所有 Agent
    for (const [poolId] of this.pool) {
      this.retireAgent(poolId, 'pool_stopped')
    }

    this.pool.clear()
    this.eventListeners = []
    console.log('[AgentPool] Stopped and cleared all agents')
  }

  // ========== Agent 获取与释放 ==========

  /**
   * 获取指定角色的 Agent（优先复用空闲 Agent）
   * @param role 角色定义
   * @returns Agent 实例
   */
  async acquireAgent(role: AgentRole): Promise<{ agent: Agent; poolId: string }> {
    // 1. 尝试复用空闲的同角色 Agent
    const idleEntry = this.findIdleAgent(role.id)
    if (idleEntry) {
      idleEntry.status = 'busy'
      idleEntry.lastActiveAt = Date.now()
      idleEntry.taskCount++

      this.emitEvent({
        type: 'agent_acquired',
        poolId: idleEntry.poolId,
        roleId: role.id
      })

      console.log(`[AgentPool] Reused idle agent ${idleEntry.poolId} for role: ${role.id}`)
      return { agent: idleEntry.agent, poolId: idleEntry.poolId }
    }

    // 2. 检查池容量限制
    const activeCount = this.getActiveCount()
    if (activeCount >= this.config.maxConcurrentAgents) {
      // 尝试 LRU 淘汰一个空闲 Agent
      const evicted = this.evictLRU()
      if (!evicted) {
        throw new Error(
          `[AgentPool] Pool capacity exceeded (${activeCount}/${this.config.maxConcurrentAgents}), no idle agents to evict`
        )
      }
    }

    // 3. 创建新 Agent
    const poolId = this.generatePoolId(role.id)

    const agent = await agentFactory.createAgent({
      config: {
        name: `${role.name} (Swarm)`,
        instructions: role.instructions,
        model: role.model
      },
      tools: role.tools
    })

    const entry: PoolAgentEntry = {
      agent,
      role,
      poolId,
      status: 'busy',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      taskCount: 1,
      successCount: 0,
      failCount: 0
    }

    this.pool.set(poolId, entry)

    this.emitEvent({
      type: 'agent_created',
      poolId,
      roleId: role.id
    })

    console.log(`[AgentPool] Created new agent ${poolId} for role: ${role.id}`)
    return { agent, poolId }
  }

  /**
   * 释放 Agent 回池中（标记为空闲）
   * @param poolId Agent 池 ID
   * @param success 任务是否成功
   */
  releaseAgent(poolId: string, success: boolean = true): void {
    const entry = this.pool.get(poolId)
    if (!entry) {
      console.warn(`[AgentPool] Agent not found: ${poolId}`)
      return
    }

    if (entry.status === 'retiring') {
      return
    }

    entry.status = 'idle'
    entry.lastActiveAt = Date.now()

    if (success) {
      entry.successCount++
    } else {
      entry.failCount++
    }

    this.emitEvent({
      type: 'agent_released',
      poolId,
      roleId: entry.role.id
    })

    console.log(
      `[AgentPool] Released agent ${poolId} (success: ${success}, total: ${entry.taskCount})`
    )
  }

  /**
   * 退休指定 Agent（从池中移除）
   * @param poolId Agent 池 ID
   * @param reason 退休原因
   */
  retireAgent(poolId: string, reason: string): void {
    const entry = this.pool.get(poolId)
    if (!entry) {
      return
    }

    entry.status = 'retiring'

    this.pool.delete(poolId)
    this.retiredCount++

    this.emitEvent({
      type: 'agent_retired',
      poolId,
      roleId: entry.role.id,
      reason
    })

    console.log(`[AgentPool] Retired agent ${poolId}, reason: ${reason}`)
  }

  // ========== 查询方法 ==========

  /**
   * 获取指定角色的空闲 Agent
   */
  private findIdleAgent(roleId: string): PoolAgentEntry | undefined {
    for (const entry of this.pool.values()) {
      if (entry.role.id === roleId && entry.status === 'idle') {
        return entry
      }
    }
    return undefined
  }

  /**
   * 获取当前活跃（非退休）的 Agent 数量
   */
  getActiveCount(): number {
    let count = 0
    for (const entry of this.pool.values()) {
      if (entry.status !== 'retiring') {
        count++
      }
    }
    return count
  }

  /**
   * 获取忙碌的 Agent 数量
   */
  getBusyCount(): number {
    let count = 0
    for (const entry of this.pool.values()) {
      if (entry.status === 'busy') {
        count++
      }
    }
    return count
  }

  /**
   * 获取指定角色的所有 Agent
   */
  getAgentsByRole(roleId: string): PoolAgentEntry[] {
    const result: PoolAgentEntry[] = []
    for (const entry of this.pool.values()) {
      if (entry.role.id === roleId) {
        result.push(entry)
      }
    }
    return result
  }

  /**
   * 获取 Agent 条目
   */
  getEntry(poolId: string): PoolAgentEntry | undefined {
    return this.pool.get(poolId)
  }

  /**
   * 获取池统计信息
   */
  getStats(): {
    totalCreated: number
    currentActive: number
    currentBusy: number
    currentIdle: number
    totalRetired: number
    roleDistribution: Record<string, number>
  } {
    const roleDistribution: Record<string, number> = {}
    let currentBusy = 0
    let currentIdle = 0

    for (const entry of this.pool.values()) {
      if (entry.status === 'busy') currentBusy++
      if (entry.status === 'idle') currentIdle++

      const roleId = entry.role.id
      roleDistribution[roleId] = (roleDistribution[roleId] || 0) + 1
    }

    return {
      totalCreated: this.createCounter,
      currentActive: this.pool.size,
      currentBusy,
      currentIdle,
      totalRetired: this.retiredCount,
      roleDistribution
    }
  }

  // ========== 清理策略 ==========

  /**
   * 清理空闲超时的 Agent
   */
  private cleanupIdleAgents(): void {
    const now = Date.now()
    const toRetire: string[] = []

    for (const [poolId, entry] of this.pool.entries()) {
      if (entry.status === 'idle' && now - entry.lastActiveAt > this.config.agentIdleTimeout) {
        toRetire.push(poolId)
      }
    }

    for (const poolId of toRetire) {
      this.retireAgent(poolId, 'idle_timeout')
    }

    if (toRetire.length > 0) {
      console.log(`[AgentPool] Cleaned up ${toRetire.length} idle agents`)
    }
  }

  /**
   * LRU 淘汰：退休最久未使用的空闲 Agent
   * @returns 是否成功淘汰
   */
  private evictLRU(): boolean {
    let oldestPoolId: string | null = null
    let oldestTime = Infinity

    for (const [poolId, entry] of this.pool.entries()) {
      if (entry.status === 'idle' && entry.lastActiveAt < oldestTime) {
        oldestTime = entry.lastActiveAt
        oldestPoolId = poolId
      }
    }

    if (oldestPoolId) {
      this.retireAgent(oldestPoolId, 'lru_eviction')
      return true
    }

    return false
  }

  // ========== 事件系统 ==========

  /**
   * 注册事件监听器
   */
  addEventListener(listener: AgentPoolEventListener): void {
    this.eventListeners.push(listener)
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: AgentPoolEventListener): void {
    const index = this.eventListeners.indexOf(listener)
    if (index !== -1) {
      this.eventListeners.splice(index, 1)
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(event: AgentPoolEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[AgentPool] Event listener error:', error)
      }
    }
  }

  // ========== 工具方法 ==========

  /**
   * 生成唯一的池 ID
   */
  private generatePoolId(roleId: string): string {
    this.createCounter++
    return `${roleId}-${this.createCounter}-${Date.now().toString(36)}`
  }
}
