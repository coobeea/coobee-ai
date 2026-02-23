/**
 * 系统可观测性统一接口
 *
 * 整合日志、指标、追踪、健康检查等可观测性功能。
 */

import { WorkerManager } from '../worker/WorkerManager';
import { ExtensionErrorBoundary } from '../extension/ExtensionErrorBoundary';
import { createLogger, type LogContext } from '../logger';
import type { WorkerInfo } from '../worker/types';

const log = createLogger('observability');

/**
 * 系统健康状态
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  components: {
    workers: {
      total: number;
      ready: number;
      error: number;
      status: 'healthy' | 'degraded' | 'unhealthy';
    };
    extensions: {
      total: number;
      failed: number;
      disabled: number;
      status: 'healthy' | 'degraded' | 'unhealthy';
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
      status: 'healthy' | 'degraded' | 'unhealthy';
    };
  };
}

/**
 * 系统指标汇总
 */
export interface SystemMetrics {
  timestamp: number;
  workers: WorkerInfo[];
  extensions: {
    errorStats: Array<{ extensionId: string; errorCount: number }>;
    disabled: string[];
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  uptime: number;
}

/**
 * 可观测性管理器
 */
export class ObservabilityManager {
  private static instance: ObservabilityManager | null = null;

  private startTime = Date.now();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ObservabilityManager {
    if (!ObservabilityManager.instance) {
      ObservabilityManager.instance = new ObservabilityManager();
    }
    return ObservabilityManager.instance;
  }

  /**
   * 获取系统健康状态
   */
  getSystemHealth(): SystemHealth {
    const workers = WorkerManager.getInstance().getAllWorkerInfo();
    const errorBoundary = ExtensionErrorBoundary.getInstance();
    const memUsage = process.memoryUsage();

    // Workers 健康状态
    const workersTotal = workers.length;
    const workersReady = workers.filter((w) => w.status === 'ready').length;
    const workersError = workers.filter((w) => w.status === 'error').length;
    const workersStatus = workersError > 0 ? 'unhealthy' : workersReady < workersTotal * 0.5 ? 'degraded' : 'healthy';

    // Extensions 健康状态
    const extensionsErrorStats = errorBoundary.getErrorStats();
    const extensionsDisabled = errorBoundary.getDisabledExtensions();
    const extensionsTotal = extensionsErrorStats.length + extensionsDisabled.length;
    const extensionsStatus =
      extensionsDisabled.length > 0 ? 'degraded' : extensionsErrorStats.length > 3 ? 'degraded' : 'healthy';

    // Memory 健康状态
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memTotalMB = memUsage.heapTotal / 1024 / 1024;
    const memPercentage = (memUsedMB / memTotalMB) * 100;
    const memoryStatus = memPercentage > 90 ? 'unhealthy' : memPercentage > 75 ? 'degraded' : 'healthy';

    // 整体状态
    const overallStatus =
      workersStatus === 'unhealthy' || memoryStatus === 'unhealthy'
        ? 'unhealthy'
        : workersStatus === 'degraded' || extensionsStatus === 'degraded' || memoryStatus === 'degraded'
          ? 'degraded'
          : 'healthy';

    return {
      status: overallStatus,
      timestamp: Date.now(),
      components: {
        workers: {
          total: workersTotal,
          ready: workersReady,
          error: workersError,
          status: workersStatus
        },
        extensions: {
          total: extensionsTotal,
          failed: extensionsErrorStats.length,
          disabled: extensionsDisabled.length,
          status: extensionsStatus
        },
        memory: {
          used: Math.round(memUsedMB),
          total: Math.round(memTotalMB),
          percentage: Math.round(memPercentage),
          status: memoryStatus
        }
      }
    };
  }

  /**
   * 获取系统指标汇总
   */
  getSystemMetrics(): SystemMetrics {
    const workers = WorkerManager.getInstance().getAllWorkerInfo();
    const errorBoundary = ExtensionErrorBoundary.getInstance();
    const memUsage = process.memoryUsage();

    return {
      timestamp: Date.now(),
      workers,
      extensions: {
        errorStats: errorBoundary.getErrorStats().map((stat) => ({
          extensionId: stat.extensionId,
          errorCount: stat.errorCount
        })),
        disabled: errorBoundary.getDisabledExtensions()
      },
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  /**
   * 记录结构化日志（可观测性增强）
   */
  logWithContext(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
    log[level](message, context);
  }

  /**
   * 触发系统健康检查并记录日志
   */
  performHealthCheck(): SystemHealth {
    const health = this.getSystemHealth();

    log.info('[Health Check] System health check completed', {
      status: health.status,
      workers: health.components.workers,
      extensions: health.components.extensions,
      memory: health.components.memory
    });

    if (health.status === 'degraded') {
      log.warn('[Health Check] System is in degraded state');
    } else if (health.status === 'unhealthy') {
      log.error('[Health Check] System is unhealthy!');
    }

    return health;
  }

  /**
   * 获取系统运行时长（秒）
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}
