import fs from 'fs-extra'
import { mkdirp } from 'mkdirp'
import path from 'path'

import { config } from './config'
import { Env } from './env'
import { log } from './logger'
import { WorkspaceCopyProgressEvent, WorkspaceSizeProgressEvent, FileCopyInfo } from './types'
import { formatSize, isDirectoryEmpty } from '../utils'

/**
 * 工作区管理器，支持配置化
 */
export class WorkspaceManager {
  /**
   * 获取根工作区路径
   * 优先从用户配置中读取，如果未配置，则使用环境默认路径
   */
  async getRootWorkspacePath(): Promise<string> {
    const workspacePath = config.getWorkspacePath()
    const workspaceDir = workspacePath ? workspacePath : await Env.getWorkspacePath()
    return workspaceDir
  }

  /**
   * 获取运行时目录(内部运行的目录，用于存储运行时数据)
   */
  async getWorkspaceRuntimeDir(): Promise<string> {
    const workspacePath = await this.getRootWorkspacePath()
    const runtimeDir = path.join(workspacePath, '.runtime')
    if (!fs.existsSync(runtimeDir)) {
      await mkdirp(runtimeDir)
    }
    return runtimeDir
  }

  /**
   * 计算工作区大小（AsyncGenerator版本，使用队列避免深度递归）
   * 通过AsyncGenerator实现非阻塞计算，并实时返回进度
   */
  async *calculateWorkspaceSize(): AsyncGenerator<WorkspaceSizeProgressEvent, number, unknown> {
    const workspaceDir = await this.getRootWorkspacePath()
    const batchSize = 50

    let processedFiles = 0
    let processedDirs = 0
    let currentSize = 0
    let processedInBatch = 0

    const queue: string[] = [workspaceDir]

    while (queue.length > 0) {
      const currentDir = queue.shift()!

      try {
        const items = await fs.readdir(currentDir)

        for (const item of items) {
          const itemPath = path.join(currentDir, item)

          try {
            const stats = await fs.stat(itemPath)

            if (stats.isFile()) {
              currentSize += stats.size
              processedFiles++
            } else if (stats.isDirectory()) {
              processedDirs++
              queue.push(itemPath)
            }

            processedInBatch++

            if (processedInBatch >= batchSize) {
              yield {
                type: 'progress',
                processedFiles,
                processedDirs,
                currentSize,
                currentPath: itemPath,
                formattedSize: formatSize(currentSize)
              } as WorkspaceSizeProgressEvent

              await new Promise((resolve) => setImmediate(resolve))
              processedInBatch = 0
            }
          } catch (statError) {
            log.warn(`无法访问: ${itemPath}`, statError)
          }
        }
      } catch (error) {
        log.error(`无法读取目录: ${currentDir}`, error)
      }
    }

    yield {
      type: 'complete',
      processedFiles,
      processedDirs,
      currentSize,
      currentPath: workspaceDir,
      formattedSize: formatSize(currentSize),
      totalSize: currentSize
    } as WorkspaceSizeProgressEvent

    return currentSize
  }

  /**
   * 扫描工作区文件列表（用于复制前的准备）
   * 使用队列模式遍历目录树，避免深度递归导致栈溢出
   */
  private async scanWorkspaceFiles(workspacePath: string): Promise<FileCopyInfo[]> {
    const files: FileCopyInfo[] = []
    const queue: string[] = [workspacePath]

    while (queue.length > 0) {
      const currentDir = queue.shift()!

      try {
        const items = await fs.readdir(currentDir)

        for (const item of items) {
          const itemPath = path.join(currentDir, item)

          try {
            const stats = await fs.stat(itemPath)
            const relativePath = path.relative(workspacePath, itemPath)

            if (stats.isFile()) {
              files.push({
                sourcePath: itemPath,
                targetPath: relativePath,
                size: stats.size,
                isDirectory: false
              })
            } else if (stats.isDirectory()) {
              files.push({
                sourcePath: itemPath,
                targetPath: relativePath,
                size: 0,
                isDirectory: true
              })
              queue.push(itemPath)
            }
          } catch (statError) {
            log.warn(`无法访问文件: ${itemPath}`, statError)
          }
        }
      } catch (error) {
        log.error(`无法读取目录: ${currentDir}`, error)
      }
    }

    return files
  }

  /**
   * 计算复制速度和剩余时间
   */
  private calculateCopyStats(
    copiedSize: number,
    totalSize: number,
    startTime: number
  ): {
    speed: number
    estimatedTimeRemaining: number
    percentage: number
    formattedSpeed: string
    elapsedTime: number
  } {
    const elapsedTime = (Date.now() - startTime) / 1000
    const speed = elapsedTime > 0 ? copiedSize / elapsedTime : 0
    const remainingSize = totalSize - copiedSize
    const estimatedTimeRemaining = speed > 0 ? remainingSize / speed : 0
    const percentage = totalSize > 0 ? (copiedSize / totalSize) * 100 : 0

    return {
      speed,
      estimatedTimeRemaining,
      percentage,
      formattedSpeed: formatSize(speed) + '/s',
      elapsedTime
    }
  }

  /**
   * 完整复制工作区
   * 使用AsyncGenerator实现流式复制，支持实时进度反馈和非阻塞执行
   */
  async *copyWorkspace(
    targetWorkspacePath: string
  ): AsyncGenerator<WorkspaceCopyProgressEvent, boolean, unknown> {
    const batchSize = 10
    const startTime = Date.now()
    let copiedFiles = 0
    let copiedDirs = 0
    let copiedSize = 0
    let processedInBatch = 0

    try {
      const sourceWorkspacePath = await this.getRootWorkspacePath()

      if (!fs.existsSync(sourceWorkspacePath)) {
        yield {
          type: 'error',
          error: `源工作区路径不存在: ${sourceWorkspacePath}`,
          copiedFiles: 0,
          copiedDirs: 0,
          copiedSize: 0
        } as WorkspaceCopyProgressEvent
        return false
      }

      if (fs.existsSync(targetWorkspacePath)) {
        const isEmpty = await isDirectoryEmpty(targetWorkspacePath)
        if (!isEmpty) {
          yield {
            type: 'error',
            error: `目标工作区路径不为空，无法复制: ${targetWorkspacePath}`,
            copiedFiles: 0,
            copiedDirs: 0,
            copiedSize: 0
          } as WorkspaceCopyProgressEvent
          return false
        }
      }

      await mkdirp(targetWorkspacePath)

      yield {
        type: 'scanning',
        copiedFiles: 0,
        copiedDirs: 0,
        copiedSize: 0
      } as WorkspaceCopyProgressEvent

      const fileList = await this.scanWorkspaceFiles(sourceWorkspacePath)
      const totalFiles = fileList.filter((f) => !f.isDirectory).length
      const totalDirs = fileList.filter((f) => f.isDirectory).length
      const totalSize = fileList.reduce((sum, f) => sum + f.size, 0)

      for (const fileInfo of fileList) {
        const targetPath = path.join(targetWorkspacePath, fileInfo.targetPath)

        try {
          if (fileInfo.isDirectory) {
            await mkdirp(targetPath)
            copiedDirs++
          } else {
            if (fs.existsSync(targetPath)) {
              copiedFiles++
              copiedSize += fileInfo.size
            } else {
              await mkdirp(path.dirname(targetPath))
              await fs.copy(fileInfo.sourcePath, targetPath, { overwrite: false })
              copiedFiles++
              copiedSize += fileInfo.size
            }
          }

          processedInBatch++

          if (processedInBatch >= batchSize) {
            const stats = this.calculateCopyStats(copiedSize, totalSize, startTime)

            yield {
              type: 'copying',
              totalFiles,
              totalDirs,
              copiedFiles,
              copiedDirs,
              currentFile: fileInfo.targetPath,
              totalSize,
              copiedSize,
              formattedTotalSize: formatSize(totalSize),
              formattedCopiedSize: formatSize(copiedSize),
              ...stats
            } as WorkspaceCopyProgressEvent

            await new Promise((resolve) => setImmediate(resolve))
            processedInBatch = 0
          }
        } catch (copyError) {
          log.error(`复制文件失败: ${fileInfo.sourcePath} -> ${targetPath}`, copyError)
        }
      }

      const finalStats = this.calculateCopyStats(copiedSize, totalSize, startTime)
      yield {
        type: 'complete',
        totalFiles,
        totalDirs,
        copiedFiles,
        copiedDirs,
        totalSize,
        copiedSize,
        formattedTotalSize: formatSize(totalSize),
        formattedCopiedSize: formatSize(copiedSize),
        ...finalStats
      } as WorkspaceCopyProgressEvent

      return true
    } catch (error) {
      yield {
        type: 'error',
        error: `复制过程中发生错误: ${error instanceof Error ? error.message : String(error)}`,
        copiedFiles,
        copiedDirs,
        copiedSize
      } as WorkspaceCopyProgressEvent
      return false
    }
  }

  /**
   * 清理工作区
   * 安全删除指定的工作区目录及其所有内容
   */
  async cleanupWorkspace(workspacePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(workspacePath)) {
        await fs.remove(workspacePath)
        return true
      }
      return true
    } catch (error) {
      log.error(`清理工作区失败: ${workspacePath}`, error)
      return false
    }
  }
}

export const workspaceManager = new WorkspaceManager()
export default workspaceManager
