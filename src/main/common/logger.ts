import Logger from 'electron-log'
import fs from 'fs'
import { mkdirp } from 'mkdirp'
import path from 'path'

import { Env } from './env'

let currentLogPath = Env.paths.logPath

const allowedLevels = ['error', 'warn', 'info', 'debug', 'verbose'] as const

type LogLevel = (typeof allowedLevels)[number]
const envLevel = Env.main.logLevel?.toLowerCase()
const logLevel: LogLevel = allowedLevels.includes(envLevel as LogLevel)
  ? (envLevel as LogLevel)
  : 'info'

// 配置文件传输
Logger.transports.file.resolvePathFn = () => {
  const installDir = currentLogPath
  return path.join(installDir, 'logs', 'main.log')
}
Logger.transports.file.level = logLevel
Logger.transports.file.maxSize = Env.main.logMaxSize
  ? Number(Env.main.logMaxSize)
  : 10 * 1024 * 1024
Logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

// 配置控制台传输
Logger.transports.console.level = logLevel
Logger.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

export const setLogPath = (logPath: string): void => {
  currentLogPath = logPath
}

export const getLogPath = (): string => {
  return currentLogPath
}

class Log {
  private logger: typeof Logger
  private initialized: boolean = false

  constructor(name?: string) {
    if (name) {
      this.logger = Logger.create({ logId: name })
      this.logger.transports.file.resolvePathFn = () => {
        return path.join(currentLogPath, 'logs', `${name}.log`)
      }
      this.logger.transports.file.level = logLevel
      this.logger.transports.file.maxSize = Env.main.logMaxSize
        ? Number(Env.main.logMaxSize)
        : 10 * 1024 * 1024
      this.logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
    } else {
      this.logger = Logger
    }
    this.init()
  }

  private async init(): Promise<void> {
    if (!this.initialized) {
      const logDir = path.dirname(this.getLogPath())
      if (!fs.existsSync(logDir)) {
        await mkdirp(logDir)
      }
      this.initialized = true
    }
  }

  info(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(message, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    this.logger.error(message, ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(message, ...args)
  }

  verbose(message: string, ...args: unknown[]): void {
    this.logger.verbose(message, ...args)
  }

  setLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose'): void {
    this.logger.transports.file.level = level
  }

  /** 单独设置控制台输出级别（不影响文件日志） */
  setConsoleLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | false): void {
    this.logger.transports.console.level = level
  }

  getLogPath(): string {
    return this.logger.transports.file.getFile().path
  }

  clear(): void {
    const logPath = this.getLogPath()
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '')
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
    throw new Error('Logger name is required')
  }
  const logger = new Log(name)
  if (options?.consoleLevel !== undefined) {
    logger.setConsoleLevel(options.consoleLevel)
  }
  return logger
}

export const log = new Log()
