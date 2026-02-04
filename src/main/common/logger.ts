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

Logger.transports.file.resolvePathFn = () => {
  const installDir = currentLogPath
  return path.join(installDir, 'logs', 'main.log')
}
Logger.transports.file.level = logLevel
Logger.transports.file.maxSize = Env.main.logMaxSize
  ? Number(Env.main.logMaxSize)
  : 10 * 1024 * 1024
Logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

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

export const createLogger = (name: string): Log => {
  if (!name) {
    throw new Error('Logger name is required')
  }
  return new Log(name)
}

export const log = new Log()
