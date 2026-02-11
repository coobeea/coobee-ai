import { exec } from 'child_process'
import fs from 'fs-extra'
import { promisify } from 'util'

import { log } from '../common/logger'
import type { Result } from '@shared/api'

const sleep = promisify(setTimeout)

export function toKebabCase(str: string): string {
  if (!str) {
    return ''
  }

  return str
    .replace(/([A-Z])/g, (match, _, offset) => (offset > 0 ? '-' : '') + match.toLowerCase())
    .replace(/[_\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase()
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

export async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(dirPath)) {
      return true
    }

    const stats = await fs.stat(dirPath)
    if (!stats.isDirectory()) {
      return false
    }

    const items = await fs.readdir(dirPath)
    return items.length === 0
  } catch (error) {
    log.warn(`检查目录是否为空时出错: ${dirPath}`, error)
    return false
  }
}

export async function forceSetWritable(targetPath: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await fs.chmod(targetPath, 0o666)
    } else {
      const stats = await fs.stat(targetPath)
      const mode = stats.isDirectory() ? 0o777 : 0o666
      await fs.chmod(targetPath, mode)
    }

    if (process.platform === 'win32') {
      await exec(`attrib -R "${targetPath}" /L /D`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`权限设置警告：${targetPath}`, error)
    }
  }
}

export async function ensureFileIsReleased(filePath: string, timeout = 5000): Promise<void> {
  log.info(`🔔 [ensureFileIsReleased] 开始检查文件锁释放: ${filePath}`)
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      await fs.rename(filePath, filePath)
      log.info(`🔔 [ensureFileIsReleased] 文件锁已释放: ${filePath}`)
      return
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code === 'ENOENT') {
        log.info(`🔔 [ensureFileIsReleased] 文件不存在，视为锁已释放: ${filePath}`)
        return
      }

      if (error.code !== 'EPERM' && error.code !== 'EBUSY') {
        log.warn(`🔔 [ensureFileIsReleased] 文件锁释放检查失败: ${filePath}`, error)
        throw error
      }

      await sleep(100)
    }
  }

  throw new Error(`🔔 [ensureFileIsReleased] 等待文件锁释放超时 (${timeout}ms): ${filePath}`)
}

// ==================== 请求/响应工具 ====================

export function createSuccessResponse<T>(data?: T, message?: string): Result<T> {
  return {
    success: true,
    code: '0',
    data,
    message,
    timestamp: Date.now()
  }
}

export function createErrorResponse(message: string, code?: string): Result {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now()
  }
}

export function createRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// ==================== 其他导出 ====================

export {
  SnowflakeIdGenerator,
  generateSnowflakeId,
  generateSnowflakeIdBigInt,
  getGlobalSnowflakeGenerator
} from './SnowflakeIdGenerator'
export { generateMachineFingerprint, generateMachineFingerprintSync } from './MachineFingerprint'
