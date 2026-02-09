/**
 * HandoffRouter - Handoff 路由管理
 *
 * 管理 Agent 间的 Handoff 关系：
 * - 根据可用角色构建 handoff 配置
 * - 运行时动态添加/移除 handoff
 * - 记录完整交接历史
 * - 检测循环交接（防止无限递归）
 */

import { Agent, handoff } from '@openai/agents'
import type { AgentRole, HandoffRecord, SwarmConfig } from './types'

/**
 * Handoff 配置项
 */
export interface HandoffOption {
  /** 目标 Agent 实例 */
  agent: Agent
  /** 目标角色 */
  role: AgentRole
  /** 工具名称覆盖 */
  toolNameOverride?: string
  /** 工具描述覆盖 */
  toolDescriptionOverride?: string
}

/**
 * Handoff 回调函数类型
 */
export type OnHandoffCallback = (fromRoleId: string, toRoleId: string, data?: unknown) => void

/**
 * Handoff 路由管理器
 */
export class HandoffRouter {
  /** Handoff 历史记录 */
  private history: HandoffRecord[] = []

  /** 记录 ID 计数器 */
  private recordCounter = 0

  /** 当前 Handoff 链（用于循环检测） */
  private currentChain: string[] = []

  /** Handoff 回调 */
  private onHandoffCallback: OnHandoffCallback | null = null

  constructor(private readonly config: SwarmConfig) {}

  // ========== Handoff 构建 ==========

  /**
   * 为 Agent 构建 handoff 配置数组
   *
   * @param currentRoleId 当前 Agent 的角色 ID
   * @param targetAgents 可交接的目标 Agent 映射 (roleId -> Agent)
   * @param roles 角色定义映射 (roleId -> AgentRole)
   * @returns handoff 对象数组，可直接用于 Agent 的 handoffs 配置
   */
  buildHandoffs(
    currentRoleId: string,
    targetAgents: Map<string, Agent>,
    roles: Map<string, AgentRole>
  ): ReturnType<typeof handoff>[] {
    const handoffs: ReturnType<typeof handoff>[] = []

    for (const [roleId, agent] of targetAgents.entries()) {
      // 不能交接给自己
      if (roleId === currentRoleId) {
        continue
      }

      const role = roles.get(roleId)
      if (!role) {
        continue
      }

      const handoffObj = handoff(agent, {
        toolNameOverride: `transfer_to_${role.id}`,
        toolDescriptionOverride: role.handoffDescription || `交接给 ${role.name}`,
        onHandoff: () => {
          this.recordHandoff(currentRoleId, roleId)
        }
      })

      handoffs.push(handoffObj)
    }

    return handoffs
  }

  /**
   * 为 Triage Agent 构建 handoff 配置
   * Triage 可以交接给所有可用角色
   */
  buildTriageHandoffs(
    targetAgents: Map<string, Agent>,
    roles: Map<string, AgentRole>
  ): ReturnType<typeof handoff>[] {
    return this.buildHandoffs('triage', targetAgents, roles)
  }

  // ========== Handoff 记录 ==========

  /**
   * 记录一次 Handoff
   */
  recordHandoff(fromRoleId: string, toRoleId: string, inputData?: unknown): HandoffRecord {
    this.recordCounter++

    // 更新 Handoff 链
    this.currentChain.push(toRoleId)
    const depth = this.currentChain.length

    const record: HandoffRecord = {
      id: `handoff-${this.recordCounter}`,
      fromRoleId,
      toRoleId,
      inputData,
      timestamp: Date.now(),
      depth
    }

    this.history.push(record)

    // 触发回调
    if (this.onHandoffCallback) {
      this.onHandoffCallback(fromRoleId, toRoleId, inputData)
    }

    console.log(
      `[HandoffRouter] Handoff #${this.recordCounter}: ${fromRoleId} -> ${toRoleId} (depth: ${depth})`
    )

    return record
  }

  // ========== 循环检测 ==========

  /**
   * 检查是否会形成循环 Handoff
   * @param targetRoleId 目标角色 ID
   * @returns 如果会循环返回 true
   */
  wouldCauseLoop(targetRoleId: string): boolean {
    // 检查目标是否已在当前链中出现过
    return this.currentChain.includes(targetRoleId)
  }

  /**
   * 检查是否已达到最大 Handoff 深度
   */
  isMaxDepthReached(): boolean {
    return this.currentChain.length >= this.config.maxHandoffDepth
  }

  /**
   * 获取当前 Handoff 深度
   */
  getCurrentDepth(): number {
    return this.currentChain.length
  }

  /**
   * 重置当前 Handoff 链（新任务开始时调用）
   */
  resetChain(): void {
    this.currentChain = []
  }

  // ========== 历史查询 ==========

  /**
   * 获取完整 Handoff 历史
   */
  getHistory(): HandoffRecord[] {
    return [...this.history]
  }

  /**
   * 获取指定 Agent 角色的 Handoff 历史
   * @param roleId 角色 ID
   * @param direction 'from' 表示从该角色发出，'to' 表示发给该角色
   */
  getHistoryByRole(roleId: string, direction: 'from' | 'to'): HandoffRecord[] {
    return this.history.filter((record) =>
      direction === 'from' ? record.fromRoleId === roleId : record.toRoleId === roleId
    )
  }

  /**
   * 获取当前执行的 Handoff 链路
   */
  getCurrentChain(): string[] {
    return [...this.currentChain]
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalHandoffs: number
    averageDepth: number
    maxDepth: number
    currentDepth: number
    roleTransitions: Record<string, number>
  } {
    const roleTransitions: Record<string, number> = {}

    let totalDepth = 0
    let maxDepth = 0

    for (const record of this.history) {
      const key = `${record.fromRoleId} -> ${record.toRoleId}`
      roleTransitions[key] = (roleTransitions[key] || 0) + 1

      totalDepth += record.depth
      if (record.depth > maxDepth) {
        maxDepth = record.depth
      }
    }

    return {
      totalHandoffs: this.history.length,
      averageDepth: this.history.length > 0 ? totalDepth / this.history.length : 0,
      maxDepth,
      currentDepth: this.currentChain.length,
      roleTransitions
    }
  }

  // ========== 事件回调 ==========

  /**
   * 设置 Handoff 发生时的回调
   */
  setOnHandoff(callback: OnHandoffCallback): void {
    this.onHandoffCallback = callback
  }

  // ========== 清理 ==========

  /**
   * 清除所有历史记录
   */
  clearHistory(): void {
    this.history = []
    this.recordCounter = 0
    this.currentChain = []
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.clearHistory()
    this.onHandoffCallback = null
  }
}
