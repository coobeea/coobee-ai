/**
 * 性能监控器
 * 收集和追踪 AI 模块的性能指标
 */

/**
 * 性能指标
 */
export interface PerformanceMetric {
  moduleName: string
  operationName: string
  duration: number
  timestamp: number
  metadata?: Record<string, unknown>
  success: boolean
  errorMessage?: string
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  moduleName: string
  operationName: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
}

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private maxMetricsSize = 10000 // 最多保留10000条
  private thresholds = new Map<string, number>() // 操作 -> 阈值（ms）

  /**
   * 设置性能阈值
   */
  setThreshold(moduleName: string, operationName: string, thresholdMs: number): void {
    const key = `${moduleName}.${operationName}`
    this.thresholds.set(key, thresholdMs)
    console.log(`[PerformanceMonitor] Set threshold: ${key} = ${thresholdMs}ms`)
  }

  /**
   * 追踪操作执行
   */
  trackExecution(
    moduleName: string,
    operationName: string,
    duration: number,
    metadata?: Record<string, unknown>,
    success: boolean = true,
    errorMessage?: string
  ): void {
    const metric: PerformanceMetric = {
      moduleName,
      operationName,
      duration,
      timestamp: Date.now(),
      metadata,
      success,
      errorMessage
    }

    // 添加到指标列表
    this.metrics.push(metric)

    // 限制大小
    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics.shift()
    }

    // 检查阈值告警
    const key = `${moduleName}.${operationName}`
    const threshold = this.thresholds.get(key)
    if (threshold && duration > threshold) {
      console.warn(
        `[PerformanceMonitor] ⚠️ Performance threshold exceeded: ${key} took ${duration}ms (threshold: ${threshold}ms)`
      )

      // TODO: 发送告警到监控服务（需要时集成 MonitoringService）
    }

    // TODO: 记录到监控服务（需要时集成 MonitoringService）
  }

  /**
   * 异步操作包装器（自动追踪性能）
   */
  async measure<T>(
    moduleName: string,
    operationName: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now()
    let success = true
    let errorMessage: string | undefined

    try {
      const result = await operation()
      return result
    } catch (error) {
      success = false
      errorMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const duration = Date.now() - startTime
      this.trackExecution(moduleName, operationName, duration, metadata, success, errorMessage)
    }
  }

  /**
   * 同步操作包装器
   */
  measureSync<T>(
    moduleName: string,
    operationName: string,
    operation: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const startTime = Date.now()
    let success = true
    let errorMessage: string | undefined

    try {
      const result = operation()
      return result
    } catch (error) {
      success = false
      errorMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const duration = Date.now() - startTime
      this.trackExecution(moduleName, operationName, duration, metadata, success, errorMessage)
    }
  }

  /**
   * 获取性能统计
   */
  getStats(moduleName?: string, operationName?: string): PerformanceStats[] {
    // 过滤指标
    let filteredMetrics = this.metrics

    if (moduleName) {
      filteredMetrics = filteredMetrics.filter((m) => m.moduleName === moduleName)
    }

    if (operationName) {
      filteredMetrics = filteredMetrics.filter((m) => m.operationName === operationName)
    }

    // 按模块和操作分组
    const groups = new Map<string, PerformanceMetric[]>()

    for (const metric of filteredMetrics) {
      const key = `${metric.moduleName}.${metric.operationName}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(metric)
    }

    // 计算统计
    const stats: PerformanceStats[] = []

    for (const [key, metrics] of groups) {
      const [module, operation] = key.split('.')
      const durations = metrics.map((m) => m.duration).sort((a, b) => a - b)
      const successCount = metrics.filter((m) => m.success).length

      stats.push({
        moduleName: module,
        operationName: operation,
        totalCalls: metrics.length,
        successCalls: successCount,
        failedCalls: metrics.length - successCount,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: durations[0],
        maxDuration: durations[durations.length - 1],
        p50Duration: durations[Math.floor(durations.length * 0.5)],
        p95Duration: durations[Math.floor(durations.length * 0.95)],
        p99Duration: durations[Math.floor(durations.length * 0.99)]
      })
    }

    return stats
  }

  /**
   * 获取最慢的操作
   */
  getSlowestOperations(limit: number = 10): PerformanceMetric[] {
    return [...this.metrics].sort((a, b) => b.duration - a.duration).slice(0, limit)
  }

  /**
   * 获取失败的操作
   */
  getFailedOperations(limit: number = 50): PerformanceMetric[] {
    return this.metrics
      .filter((m) => !m.success)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  /**
   * 清空指标
   */
  clear(): void {
    this.metrics = []
    console.log('[PerformanceMonitor] Metrics cleared')
  }

  /**
   * 导出指标（用于分析）
   */
  exportMetrics(): PerformanceMetric[] {
    return [...this.metrics]
  }
}

/**
 * 全局性能监控实例
 */
export const performanceMonitor = new PerformanceMonitor()

// 设置默认阈值
performanceMonitor.setThreshold('orchestrator', 'executeTask', 30000) // 30秒
performanceMonitor.setThreshold('planner', 'plan', 10000) // 10秒
performanceMonitor.setThreshold('worker', 'executeSubTask', 60000) // 60秒
performanceMonitor.setThreshold('stream', 'emit', 100) // 100ms
