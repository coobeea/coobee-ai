/**
 * 性能基准测试框架
 *
 * 提供统一的性能测试接口，用于测量系统各个模块的性能。
 */

import { createLogger } from '../logger';

const log = createLogger('benchmark');

/**
 * 基准测试结果
 */
export interface BenchmarkResult {
  name: string;
  operations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
  };
}

/**
 * 基准测试配置
 */
export interface BenchmarkConfig {
  /** 测试名称 */
  name: string;
  /** 测试次数 */
  iterations: number;
  /** 预热次数（不计入统计） */
  warmup?: number;
  /** 是否输出详细日志 */
  verbose?: boolean;
}

/**
 * 性能基准测试
 */
export class PerformanceBenchmark {
  /**
   * 运行基准测试
   */
  static async run<T>(config: BenchmarkConfig, fn: () => Promise<T> | T): Promise<BenchmarkResult> {
    const { name, iterations, warmup = 0, verbose = false } = config;

    if (verbose) {
      log.info(`[Benchmark] Starting: ${name} (iterations: ${iterations}, warmup: ${warmup})`);
    }

    // 预热
    for (let i = 0; i < warmup; i++) {
      await fn();
    }

    // 实际测试
    const durations: number[] = [];
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      const iterStart = performance.now();
      await fn();
      const iterEnd = performance.now();
      durations.push(iterEnd - iterStart);
    }

    const end = Date.now();
    const totalMs = end - start;

    // 计算统计数据
    durations.sort((a, b) => a - b);
    const minMs = durations[0];
    const maxMs = durations[durations.length - 1];
    const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const opsPerSec = (iterations / totalMs) * 1000;

    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];

    const result: BenchmarkResult = {
      name,
      operations: iterations,
      totalMs,
      avgMs: Math.round(avgMs * 100) / 100,
      minMs: Math.round(minMs * 100) / 100,
      maxMs: Math.round(maxMs * 100) / 100,
      opsPerSec: Math.round(opsPerSec),
      percentiles: {
        p50: Math.round(p50 * 100) / 100,
        p95: Math.round(p95 * 100) / 100,
        p99: Math.round(p99 * 100) / 100
      }
    };

    if (verbose) {
      this.logResult(result);
    }

    return result;
  }

  /**
   * 运行多个基准测试并比较
   */
  static async compare(
    benchmarks: Array<{ name: string; fn: () => Promise<unknown> | unknown }>,
    config: Omit<BenchmarkConfig, 'name'> = { iterations: 1000 }
  ): Promise<BenchmarkResult[]> {
    log.info(`[Benchmark] Running ${benchmarks.length} benchmarks for comparison`);

    const results: BenchmarkResult[] = [];

    for (const { name, fn } of benchmarks) {
      const result = await this.run({ ...config, name }, fn);
      results.push(result);
    }

    // 按 opsPerSec 排序（降序）
    results.sort((a, b) => b.opsPerSec - a.opsPerSec);

    // 输出对比报告
    log.info('[Benchmark] Comparison Results:');
    results.forEach((result, index) => {
      const fastest = results[0];
      const ratio = (fastest.opsPerSec / result.opsPerSec).toFixed(2);
      const suffix = index === 0 ? ' (FASTEST)' : ` (${ratio}x slower)`;
      log.info(`  ${index + 1}. ${result.name}: ${result.opsPerSec} ops/sec${suffix}`);
    });

    return results;
  }

  /**
   * 记录测试结果
   */
  private static logResult(result: BenchmarkResult): void {
    log.info(`[Benchmark] Results for "${result.name}":`);
    log.info(`  Operations: ${result.operations}`);
    log.info(`  Total time: ${result.totalMs}ms`);
    log.info(`  Avg: ${result.avgMs}ms`);
    log.info(`  Min: ${result.minMs}ms`);
    log.info(`  Max: ${result.maxMs}ms`);
    log.info(`  Throughput: ${result.opsPerSec} ops/sec`);
    log.info(
      `  Percentiles: p50=${result.percentiles.p50}ms, p95=${result.percentiles.p95}ms, p99=${result.percentiles.p99}ms`
    );
  }

  /**
   * 测量单次操作耗时（简化接口）
   */
  static async measure<T>(name: string, fn: () => Promise<T> | T): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    const duration = end - start;

    log.info(`[Benchmark] ${name}: ${duration.toFixed(2)}ms`);

    return { result, duration };
  }
}

/**
 * 便捷装饰器：自动测量方法执行时间
 */
export function benchmark(name?: string) {
  return function (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const benchmarkName = name || propertyKey;

    descriptor.value = async function (...args: unknown[]) {
      const { result } = await PerformanceBenchmark.measure(benchmarkName, () => originalMethod.apply(this, args));
      return result;
    };

    return descriptor;
  };
}
