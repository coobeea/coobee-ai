/**
 * Worker 监控指标收集器
 *
 * 职责：
 *   1. 收集 Worker 进程的 CPU、内存使用情况
 *   2. 记录健康检查响应时间
 *   3. 计算运行时长
 *   4. 提供实时和历史指标数据
 */

import { ChildProcess } from 'node:child_process';
import { totalmem } from 'node:os';
import { readFile } from 'node:fs/promises';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@main/common/logger';
import type { WorkerMetrics } from './types';

const exec = promisify(execCallback);

const log = createLogger('worker-metrics');

/**
 * 进程资源使用数据
 */
interface ProcessUsage {
  cpu: number; // CPU 时间（微秒）
  memory: number; // RSS 内存（字节）
}

/**
 * Worker 监控指标收集器
 *
 * 每个 Worker 实例对应一个 Collector，定期收集指标。
 */
export class WorkerMetricsCollector {
  private process: ChildProcess;
  private startTime: number;
  private lastCpuUsage: ProcessUsage | null = null;
  private lastMeasureTime: number = 0;
  private healthCheckLatencies: number[] = []; // 最近 10 次健康检查延迟
  private collectInterval: NodeJS.Timeout | null = null;
  private currentMetrics: WorkerMetrics;

  constructor(
    private workerName: string,
    process: ChildProcess
  ) {
    this.process = process;
    this.startTime = Date.now();
    this.currentMetrics = this.getDefaultMetrics();
  }

  /**
   * 开始收集指标（每 5 秒一次）
   */
  start(): void {
    if (this.collectInterval) {
      return;
    }

    // 立即收集一次
    this.collect().catch((err) => {
      log.error(`[${this.workerName}] Initial metrics collection failed:`, err);
    });

    // 定期收集
    this.collectInterval = setInterval(() => {
      this.collect().catch((err) => {
        log.error(`[${this.workerName}] Metrics collection failed:`, err);
      });
    }, 5000); // 每 5 秒

    log.debug(`[${this.workerName}] Metrics collector started`);
  }

  /**
   * 停止收集
   */
  stop(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
      log.debug(`[${this.workerName}] Metrics collector stopped`);
    }
  }

  /**
   * 记录健康检查结果
   */
  recordHealthCheck(success: boolean, latency: number): void {
    this.healthCheckLatencies.push(latency);
    if (this.healthCheckLatencies.length > 10) {
      this.healthCheckLatencies.shift(); // 保持最近 10 次
    }

    this.currentMetrics.lastHealthCheck = {
      success,
      timestamp: Date.now(),
      latency
    };
  }

  /**
   * 获取当前指标
   */
  getMetrics(): WorkerMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * 收集一次指标
   */
  private async collect(): Promise<void> {
    if (!this.process || !this.process.pid) {
      return;
    }

    try {
      const usage = await this.getProcessUsage(this.process.pid);
      const now = Date.now();
      const elapsed = this.lastMeasureTime > 0 ? now - this.lastMeasureTime : 0;

      // 计算 CPU 使用率
      let cpuPercent = 0;
      if (this.lastCpuUsage && elapsed > 0) {
        const cpuDelta = usage.cpu - this.lastCpuUsage.cpu;
        // CPU 使用率 = (CPU 时间增量 / 真实时间增量) * 100
        // 注意：cpuDelta 是微秒，elapsed 是毫秒
        cpuPercent = Math.min(100, Math.max(0, (cpuDelta / (elapsed * 1000)) * 100));
      }

      this.lastCpuUsage = usage;
      this.lastMeasureTime = now;

      // 计算内存使用率（相对于系统总内存）
      const totalMemory = totalmem();
      const memoryPercent = Math.min(100, (usage.memory / totalMemory) * 100);

      // 计算平均健康检查延迟
      const avgHealthCheckLatency =
        this.healthCheckLatencies.length > 0
          ? this.healthCheckLatencies.reduce((a, b) => a + b, 0) / this.healthCheckLatencies.length
          : 0;

      // 更新指标
      this.currentMetrics = {
        cpuPercent: Math.round(cpuPercent * 10) / 10, // 保留 1 位小数
        memoryBytes: usage.memory,
        memoryPercent: Math.round(memoryPercent * 10) / 10,
        healthCheckLatency: Math.round(avgHealthCheckLatency),
        uptimeSeconds: Math.floor((now - this.startTime) / 1000),
        lastHealthCheck: this.currentMetrics.lastHealthCheck
      };

      // Metrics 数据已存储在 currentMetrics 中，可通过 getMetrics() 获取
      // 不需要每 5 秒打印到控制台
    } catch (err) {
      log.error(`[${this.workerName}] Failed to collect metrics:`, err);
    }
  }

  /**
   * 获取进程资源使用情况（跨平台）
   */
  private async getProcessUsage(pid: number): Promise<ProcessUsage> {
    const platform = process.platform;

    if (platform === 'linux') {
      return this.getLinuxProcessUsage(pid);
    } else if (platform === 'darwin') {
      return this.getMacOSProcessUsage(pid);
    } else if (platform === 'win32') {
      return this.getWindowsProcessUsage(pid);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Linux: 读取 /proc/{pid}/stat 获取 CPU 和内存
   */
  private async getLinuxProcessUsage(pid: number): Promise<ProcessUsage> {
    const statPath = `/proc/${pid}/stat`;

    try {
      const content = await readFile(statPath, 'utf-8');
      const parts = content.split(' ');

      // utime (14) + stime (15) = CPU 时间（时钟滴答）
      const utime = parseInt(parts[13], 10);
      const stime = parseInt(parts[14], 10);
      const clockTicks = utime + stime;

      // RSS (24) = 常驻内存（页数）
      const rss = parseInt(parts[23], 10);
      const pageSize = 4096; // Linux 通常是 4KB
      const memoryBytes = rss * pageSize;

      // 转换为微秒（假设 100 ticks/s，即 10ms/tick = 10000us/tick）
      const clockTicksPerSecond = 100; // sysconf(_SC_CLK_TCK)
      const cpuMicroseconds = (clockTicks * 1000000) / clockTicksPerSecond;

      return {
        cpu: cpuMicroseconds,
        memory: memoryBytes
      };
    } catch (err) {
      throw new Error(`Failed to read /proc/${pid}/stat: ${err}`);
    }
  }

  /**
   * macOS: 使用 ps 命令获取 CPU 和内存
   */
  private async getMacOSProcessUsage(pid: number): Promise<ProcessUsage> {
    try {
      // ps -p {pid} -o %cpu,rss
      // %cpu: CPU 使用率（0-100）
      // rss: RSS 内存（KB）
      const { stdout } = await exec(`ps -p ${pid} -o %cpu,rss | tail -1`);
      const parts = stdout.trim().split(/\s+/);

      const cpuPercent = parseFloat(parts[0] || '0');
      const rssKB = parseInt(parts[1] || '0', 10);

      // 将 CPU% 转换为累积时间（近似，基于当前使用率）
      const uptimeSeconds = (Date.now() - this.startTime) / 1000;
      const cpuMicroseconds = (cpuPercent / 100) * uptimeSeconds * 1000000;

      return {
        cpu: cpuMicroseconds,
        memory: rssKB * 1024
      };
    } catch (err) {
      throw new Error(`Failed to execute ps command: ${err}`);
    }
  }

  /**
   * Windows: 使用 wmic 或 Node.js process.memoryUsage
   */
  private async getWindowsProcessUsage(pid: number): Promise<ProcessUsage> {
    try {
      // wmic process where ProcessId={pid} get WorkingSetSize
      const { stdout } = await exec(`wmic process where ProcessId=${pid} get WorkingSetSize`);
      const lines = stdout.trim().split('\n');
      const memoryBytes = parseInt(lines[1]?.trim() || '0', 10);

      // Windows CPU 时间难以获取，使用简化方案（0%，待优化）
      return {
        cpu: 0,
        memory: memoryBytes
      };
    } catch (err) {
      throw new Error(`Failed to execute wmic command: ${err}`);
    }
  }

  /**
   * 默认指标（进程未启动时）
   */
  private getDefaultMetrics(): WorkerMetrics {
    return {
      cpuPercent: 0,
      memoryBytes: 0,
      memoryPercent: 0,
      healthCheckLatency: 0,
      uptimeSeconds: 0,
      lastHealthCheck: {
        success: false,
        timestamp: 0,
        latency: 0
      }
    };
  }
}
