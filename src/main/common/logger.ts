import Logger from 'electron-log';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { Env } from './env';

let currentLogPath = Env.paths.logPath;

const allowedLevels = ['error', 'warn', 'info', 'debug', 'verbose'] as const;

type LogLevel = (typeof allowedLevels)[number];
const envLevel = Env.main.logLevel?.toLowerCase();
const logLevel: LogLevel = allowedLevels.includes(envLevel as LogLevel) ? (envLevel as LogLevel) : 'info';

// 配置文件传输
Logger.transports.file.resolvePathFn = () => {
  const installDir = currentLogPath;
  return path.join(installDir, 'logs', 'main.log');
};
Logger.transports.file.level = logLevel;
Logger.transports.file.maxSize = Env.main.logMaxSize ? Number(Env.main.logMaxSize) : 10 * 1024 * 1024;
Logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

// 配置控制台传输
Logger.transports.console.level = logLevel;
Logger.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

export const setLogPath = (logPath: string): void => {
  currentLogPath = logPath;
};

export const getLogPath = (): string => {
  return currentLogPath;
};

/**
 * 结构化日志上下文
 */
export interface LogContext {
  /** 请求ID（用于追踪请求链路） */
  requestId?: string;
  /** 会话ID（用于追踪会话） */
  sessionId?: string;
  /** 用户ID */
  userId?: string;
  /** 自定义元数据 */
  meta?: Record<string, unknown>;
}

/**
 * 性能计时器
 */
export class PerformanceTimer {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor(
    private logger: Log,
    private operation: string,
    private context?: LogContext
  ) {
    this.startTime = Date.now();
  }

  /** 记录检查点 */
  checkpoint(name: string): void {
    this.checkpoints.set(name, Date.now() - this.startTime);
  }

  /** 结束计时并记录 */
  end(additionalContext?: Record<string, unknown>): number {
    const duration = Date.now() - this.startTime;
    const checkpointsObj = Object.fromEntries(this.checkpoints);

    this.logger.info(`[Performance] ${this.operation} completed`, {
      duration,
      checkpoints: checkpointsObj,
      ...this.context,
      ...additionalContext
    });

    return duration;
  }
}

class Log {
  private logger: typeof Logger;
  private initialized: boolean = false;
  private defaultContext?: LogContext;
  private samplingRates: Map<string, { rate: number; counter: number }> = new Map();

  constructor(name?: string) {
    if (name) {
      this.logger = Logger.create({ logId: name });
      this.logger.transports.file.resolvePathFn = () => {
        return path.join(currentLogPath, 'logs', `${name}.log`);
      };
      this.logger.transports.file.level = logLevel;
      this.logger.transports.file.maxSize = Env.main.logMaxSize ? Number(Env.main.logMaxSize) : 10 * 1024 * 1024;
      this.logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
    } else {
      this.logger = Logger;
    }
    this.init();
  }

  private async init(): Promise<void> {
    if (!this.initialized) {
      const logDir = path.dirname(this.getLogPath());
      if (!fs.existsSync(logDir)) {
        await mkdirp(logDir);
      }
      this.initialized = true;
    }
  }

  /**
   * 设置默认上下文（后续所有日志都会包含）
   */
  setContext(context: LogContext): void {
    this.defaultContext = context;
  }

  /**
   * 清除默认上下文
   */
  clearContext(): void {
    this.defaultContext = undefined;
  }

  /**
   * 格式化日志消息（支持结构化数据）
   */
  private formatMessage(message: string, context?: LogContext | Record<string, unknown>): string {
    const mergedContext = { ...this.defaultContext, ...context };
    if (Object.keys(mergedContext).length === 0) {
      return message;
    }

    try {
      const contextStr = JSON.stringify(mergedContext);
      return `${message} ${contextStr}`;
    } catch {
      return message;
    }
  }

  /**
   * 采样日志（降低高频日志的输出频率）
   *
   * @param key 采样键（通常是日志消息的标识）
   * @param rate 采样率（1/N，如 10 表示每 10 条记录 1 条）
   */
  private shouldSample(key: string, rate: number): boolean {
    if (rate <= 1) return true; // 不采样

    let sampling = this.samplingRates.get(key);
    if (!sampling) {
      sampling = { rate, counter: 0 };
      this.samplingRates.set(key, sampling);
    }

    sampling.counter++;
    const should = sampling.counter % rate === 1;
    return should;
  }

  info(message: string, ...args: unknown[]): void {
    // 支持向后兼容：如果第一个参数是对象，视为 context
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger.info(this.formatMessage(message, args[0] as LogContext | Record<string, unknown>));
    } else {
      this.logger.info(message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger.warn(this.formatMessage(message, args[0] as LogContext | Record<string, unknown>));
    } else {
      this.logger.warn(message, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger.error(this.formatMessage(message, args[0] as LogContext | Record<string, unknown>));
    } else {
      this.logger.error(message, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger.debug(this.formatMessage(message, args[0] as LogContext | Record<string, unknown>));
    } else {
      this.logger.debug(message, ...args);
    }
  }

  verbose(message: string, ...args: unknown[]): void {
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
      this.logger.verbose(this.formatMessage(message, args[0] as LogContext | Record<string, unknown>));
    } else {
      this.logger.verbose(message, ...args);
    }
  }

  /**
   * 采样日志（高频场景使用）
   */
  infoSampled(
    message: string,
    samplingKey: string,
    rate: number,
    context?: LogContext | Record<string, unknown>
  ): void {
    if (this.shouldSample(samplingKey, rate)) {
      this.info(message, context);
    }
  }

  /**
   * 创建性能计时器
   */
  startTimer(operation: string, context?: LogContext): PerformanceTimer {
    return new PerformanceTimer(this, operation, context);
  }

  setLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose'): void {
    this.logger.transports.file.level = level;
  }

  /** 单独设置控制台输出级别（不影响文件日志） */
  setConsoleLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | false): void {
    this.logger.transports.console.level = level;
  }

  getLogPath(): string {
    return this.logger.transports.file.getFile().path;
  }

  clear(): void {
    const logPath = this.getLogPath();
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }
  }
}

/**
 * 创建命名日志实例
 *
 * @param name 日志名称（对应 logs/{name}.log）
 * @param options 可选配置
 * @param options.consoleLevel 控制台输出级别（默认跟随全局设置，设 false 禁用控制台输出）
 */
export const createLogger = (
  name: string,
  options?: { consoleLevel?: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | false }
): Log => {
  if (!name) {
    throw new Error('Logger name is required');
  }
  const logger = new Log(name);
  if (options?.consoleLevel !== undefined) {
    logger.setConsoleLevel(options.consoleLevel);
  }
  return logger;
};

export const log = new Log();
