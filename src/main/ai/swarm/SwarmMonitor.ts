/**
 * SwarmMonitor - 执行监控与指标
 *
 * 跟踪 Swarm 执行过程：
 * - Handoff 追踪
 * - 性能指标（执行时间、成功率）
 * - 异常检测（循环交接、超时、失败率过高）
 * - 角色使用分析
 */

import type { SwarmMetrics } from './types'
import { createInitialSwarmMetrics } from './types'

/**
 * 执行记录
 */
interface ExecutionRecord {
  /** 任务 ID */
  taskId: string
  /** 开始时间 */
  startedAt: number
  /** 结束时间 */
  completedAt?: number
  /** 执行时长（ms） */
  duration?: number
  /** 是否成功 */
  success: boolean
  /** Handoff 次数 */
  handoffCount: number
  /** Handoff 最大深度 */
  maxHandoffDepth: number
  /** 使用的角色 */
  rolesUsed: string[]
  /** 错误信息 */
  error?: string
}

/**
 * 异常警告
 */
export interface SwarmAlert {
  /** 警告类型 */
  type: 'loop_detected' | 'timeout' | 'high_failure_rate' | 'depth_limit' | 'pool_exhausted'
  /** 警告消息 */
  message: string
  /** 严重程度 */
  severity: 'warning' | 'error'
  /** 触发时间 */
  timestamp: number
  /** 相关数据 */
  data?: Record<string, unknown>
}

/**
 * 警告监听器
 */
export type AlertListener = (alert: SwarmAlert) => void

/**
 * Swarm 执行监控器
 */
export class SwarmMonitor {
  /** 累积指标 */
  private metrics: SwarmMetrics = createInitialSwarmMetrics()

  /** 执行记录历史 */
  private executionRecords: ExecutionRecord[] = []

  /** 当前执行（进行中） */
  private currentExecution: ExecutionRecord | null = null

  /** 警告历史 */
  private alerts: SwarmAlert[] = []

  /** 警告监听器 */
  private alertListeners: AlertListener[] = []

  /** 失败率阈值（超过则告警） */
  private readonly failureRateThreshold = 0.5

  /** 执行超时阈值（ms） */
  private readonly executionTimeoutMs = 5 * 60 * 1000 // 5 分钟

  // ========== 执行跟踪 ==========

  /**
   * 开始跟踪一次执行
   */
  startExecution(taskId: string): void {
    this.currentExecution = {
      taskId,
      startedAt: Date.now(),
      success: false,
      handoffCount: 0,
      maxHandoffDepth: 0,
      rolesUsed: []
    }

    this.metrics.totalExecutions++
    console.log(`[SwarmMonitor] Execution started: ${taskId}`)
  }

  /**
   * 记录 Handoff 事件
   */
  recordHandoff(_fromRoleId: string, toRoleId: string, depth: number): void {
    this.metrics.totalHandoffs++

    // 更新角色使用计数
    this.metrics.roleUsageCount[toRoleId] = (this.metrics.roleUsageCount[toRoleId] || 0) + 1

    if (this.currentExecution) {
      this.currentExecution.handoffCount++
      if (depth > this.currentExecution.maxHandoffDepth) {
        this.currentExecution.maxHandoffDepth = depth
      }

      if (!this.currentExecution.rolesUsed.includes(toRoleId)) {
        this.currentExecution.rolesUsed.push(toRoleId)
      }
    }

    // 更新全局最大深度
    if (depth > this.metrics.maxHandoffDepth) {
      this.metrics.maxHandoffDepth = depth
    }
  }

  /**
   * 标记执行完成
   */
  completeExecution(success: boolean, error?: string): void {
    if (!this.currentExecution) {
      return
    }

    const now = Date.now()
    this.currentExecution.completedAt = now
    this.currentExecution.duration = now - this.currentExecution.startedAt
    this.currentExecution.success = success
    this.currentExecution.error = error

    // 更新指标
    if (success) {
      this.metrics.successCount++
    } else {
      this.metrics.failCount++
    }

    // 更新平均 Handoff 深度
    this.updateAverageHandoffDepth()

    // 更新平均执行时间
    this.updateAverageDuration()

    // 记录到历史
    this.executionRecords.push({ ...this.currentExecution })

    console.log(
      `[SwarmMonitor] Execution completed: ${this.currentExecution.taskId}`,
      `(success: ${success}, duration: ${this.currentExecution.duration}ms,`,
      `handoffs: ${this.currentExecution.handoffCount})`
    )

    // 异常检测
    this.detectAnomalies()

    this.currentExecution = null
  }

  /**
   * 记录 Agent 池事件
   */
  recordPoolEvent(type: 'created' | 'retired', _roleId: string): void {
    if (type === 'created') {
      this.metrics.poolStats.totalCreated++
      this.metrics.poolStats.currentActive++
    } else if (type === 'retired') {
      this.metrics.poolStats.totalRetired++
      this.metrics.poolStats.currentActive = Math.max(0, this.metrics.poolStats.currentActive - 1)
    }
  }

  // ========== 异常检测 ==========

  /**
   * 执行异常检测
   */
  private detectAnomalies(): void {
    // 1. 高失败率检测
    if (this.metrics.totalExecutions >= 5) {
      const failureRate = this.metrics.failCount / this.metrics.totalExecutions
      if (failureRate > this.failureRateThreshold) {
        this.raiseAlert({
          type: 'high_failure_rate',
          message: `失败率过高: ${(failureRate * 100).toFixed(1)}% (${this.metrics.failCount}/${this.metrics.totalExecutions})`,
          severity: 'warning',
          timestamp: Date.now(),
          data: { failureRate, total: this.metrics.totalExecutions }
        })
      }
    }

    // 2. 执行超时检测
    if (this.currentExecution) {
      const elapsed = Date.now() - this.currentExecution.startedAt
      if (elapsed > this.executionTimeoutMs) {
        this.raiseAlert({
          type: 'timeout',
          message: `执行超时: ${this.currentExecution.taskId} (${elapsed}ms)`,
          severity: 'error',
          timestamp: Date.now(),
          data: {
            taskId: this.currentExecution.taskId,
            elapsed
          }
        })
      }
    }
  }

  /**
   * 检测循环 Handoff（由 HandoffRouter 触发）
   */
  detectLoop(chain: string[], targetRoleId: string): void {
    if (chain.includes(targetRoleId)) {
      this.raiseAlert({
        type: 'loop_detected',
        message: `检测到循环 Handoff: ${chain.join(' -> ')} -> ${targetRoleId}`,
        severity: 'error',
        timestamp: Date.now(),
        data: { chain, targetRoleId }
      })
    }
  }

  /**
   * 检测深度限制
   */
  detectDepthLimit(currentDepth: number, maxDepth: number): void {
    if (currentDepth >= maxDepth) {
      this.raiseAlert({
        type: 'depth_limit',
        message: `Handoff 深度达到上限: ${currentDepth}/${maxDepth}`,
        severity: 'warning',
        timestamp: Date.now(),
        data: { currentDepth, maxDepth }
      })
    }
  }

  /**
   * 检测 Agent 池耗尽
   */
  detectPoolExhaustion(activeCount: number, maxCount: number): void {
    if (activeCount >= maxCount) {
      this.raiseAlert({
        type: 'pool_exhausted',
        message: `Agent 池已满: ${activeCount}/${maxCount}`,
        severity: 'warning',
        timestamp: Date.now(),
        data: { activeCount, maxCount }
      })
    }
  }

  // ========== 警告系统 ==========

  /**
   * 触发警告
   */
  private raiseAlert(alert: SwarmAlert): void {
    this.alerts.push(alert)

    const prefix = alert.severity === 'error' ? 'ERROR' : 'WARN'
    console.log(`[SwarmMonitor] [${prefix}] ${alert.message}`)

    for (const listener of this.alertListeners) {
      try {
        listener(alert)
      } catch (error) {
        console.error('[SwarmMonitor] Alert listener error:', error)
      }
    }
  }

  /**
   * 注册警告监听器
   */
  addAlertListener(listener: AlertListener): void {
    this.alertListeners.push(listener)
  }

  /**
   * 移除警告监听器
   */
  removeAlertListener(listener: AlertListener): void {
    const index = this.alertListeners.indexOf(listener)
    if (index !== -1) {
      this.alertListeners.splice(index, 1)
    }
  }

  /**
   * 获取所有警告
   */
  getAlerts(): SwarmAlert[] {
    return [...this.alerts]
  }

  /**
   * 获取指定类型的警告
   */
  getAlertsByType(type: SwarmAlert['type']): SwarmAlert[] {
    return this.alerts.filter((a) => a.type === type)
  }

  // ========== 指标查询 ==========

  /**
   * 获取累积指标
   */
  getMetrics(): SwarmMetrics {
    return { ...this.metrics }
  }

  /**
   * 获取执行记录
   */
  getExecutionRecords(): ExecutionRecord[] {
    return [...this.executionRecords]
  }

  /**
   * 获取最近 N 条执行记录
   */
  getRecentExecutions(count: number = 10): ExecutionRecord[] {
    return this.executionRecords.slice(-count)
  }

  /**
   * 获取角色使用排名
   */
  getRoleUsageRanking(): Array<{ roleId: string; count: number }> {
    return Object.entries(this.metrics.roleUsageCount)
      .map(([roleId, count]) => ({ roleId, count }))
      .sort((a, b) => b.count - a.count)
  }

  // ========== 内部计算 ==========

  /**
   * 更新平均 Handoff 深度
   */
  private updateAverageHandoffDepth(): void {
    if (this.executionRecords.length === 0 && !this.currentExecution) {
      return
    }

    const allRecords = [
      ...this.executionRecords,
      ...(this.currentExecution ? [this.currentExecution] : [])
    ]

    const totalDepth = allRecords.reduce((sum, r) => sum + r.maxHandoffDepth, 0)
    this.metrics.averageHandoffDepth = totalDepth / allRecords.length
  }

  /**
   * 更新平均执行时间
   */
  private updateAverageDuration(): void {
    const completedRecords = this.executionRecords.filter((r) => r.duration !== undefined)
    if (completedRecords.length === 0) {
      return
    }

    const totalDuration = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0)
    this.metrics.averageDuration = totalDuration / completedRecords.length
  }

  // ========== 清理 ==========

  /**
   * 重置所有指标
   */
  reset(): void {
    this.metrics = createInitialSwarmMetrics()
    this.executionRecords = []
    this.currentExecution = null
    this.alerts = []
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.reset()
    this.alertListeners = []
  }
}
