/**
 * 监控服务
 * 基于 @openai/agents Tracing 的扩展
 */

/**
 * 监控指标
 */
export interface MonitoringMetrics {
  sessionId: string
  status: 'running' | 'completed' | 'failed'
  startTime: number
  endTime?: number
  messagesCount: number
  tokensUsed?: number
}

/**
 * 监控事件
 */
export interface MonitoringEvent {
  type: 'session_started' | 'session_ended' | 'message_sent' | 'message_received' | 'error'
  sessionId: string
  data: Record<string, unknown>
  timestamp: number
}

/**
 * 监控服务接口
 */
export interface IMonitoringService {
  startMonitoring(sessionId: string): void
  stopMonitoring(sessionId: string): void
  recordEvent(event: MonitoringEvent): void
  getMetrics(sessionId: string): MonitoringMetrics | null
  subscribe(callback: (event: MonitoringEvent) => void): () => void
}

/**
 * 监控服务实现
 */
export class MonitoringService implements IMonitoringService {
  private metrics = new Map<string, MonitoringMetrics>()
  private subscribers: Array<(event: MonitoringEvent) => void> = []

  startMonitoring(sessionId: string): void {
    this.metrics.set(sessionId, {
      sessionId,
      status: 'running',
      startTime: Date.now(),
      messagesCount: 0
    })

    this.recordEvent({
      type: 'session_started',
      sessionId,
      data: {},
      timestamp: Date.now()
    })
  }

  stopMonitoring(sessionId: string): void {
    const metrics = this.metrics.get(sessionId)
    if (metrics) {
      metrics.status = 'completed'
      metrics.endTime = Date.now()
    }

    this.recordEvent({
      type: 'session_ended',
      sessionId,
      data: { metrics },
      timestamp: Date.now()
    })
  }

  recordEvent(event: MonitoringEvent): void {
    this.subscribers.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[MonitoringService] Error in subscriber:', error)
      }
    })
  }

  getMetrics(sessionId: string): MonitoringMetrics | null {
    return this.metrics.get(sessionId) || null
  }

  subscribe(callback: (event: MonitoringEvent) => void): () => void {
    this.subscribers.push(callback)
    return () => {
      const index = this.subscribers.indexOf(callback)
      if (index >= 0) {
        this.subscribers.splice(index, 1)
      }
    }
  }
}
