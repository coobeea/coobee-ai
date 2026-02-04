import { WorkspaceCopyProgressEvent, WorkspaceSizeProgressEvent } from '@shared/sse.d';
import fs from 'fs-extra';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { config } from './config';
import { Env } from './env';
import { formatSize, isDirectoryEmpty } from './utils';

/**
 * 文件复制信息
 */
interface FileCopyInfo {
  sourcePath: string; // 源文件的绝对路径
  targetPath: string; // 目标文件的相对路径（相对于目标工作区根目录）
  size: number; // 文件大小（字节），目录为0
  isDirectory: boolean; // 是否为目录
}

/**
 * 工作区管理器，支持配置化
 */
export class WorkspaceManager {
  /**
   * 获取根工作区路径
   * 优先从用户配置中读取，如果未配置，则使用环境默认路径
   * @returns 根工作区路径
   */
  async getRootWorkspacePath(): Promise<string> {
    // 尝试从配置中获取工作区路径
    const workspacePath = config.getWorkspacePath();
    // 如果配置中存在路径，则直接使用；否则，获取环境相关的默认工作区路径
    const workspaceDir = workspacePath ? workspacePath : await Env.getWorkspacePath();
    return workspaceDir;
  }

  /**
   * 获取运行时目录(内部运行的目录，用于存储运行时数据)
   * @returns 运行时目录
   */
  async getWorkspaceRuntimeDir(): Promise<string> {
    const workspacePath = await this.getRootWorkspacePath();
    const runtimeDir = path.join(workspacePath, '.runtime');
    if (!fs.existsSync(runtimeDir)) {
      await mkdirp(runtimeDir);
    }
    return runtimeDir;
  }

  /**
   * 获取指定用户的工作区路径
   * 如果用户的工作区目录不存在，会自动创建
   * @param userId 用户ID
   * @returns 用户工作区路径
   */
  async getWorkspacePath(userId: string): Promise<string> {
    // 获取根工作区路径
    const workspaceDir = await this.getRootWorkspacePath();
    // 拼接用户专属的工作区路径
    const userWorkspaceDir = path.join(workspaceDir, userId);
    // 检查目录是否存在，不存在则创建
    if (!fs.existsSync(userWorkspaceDir)) {
      await mkdirp(userWorkspaceDir);
    }
    return userWorkspaceDir;
  }

  /**
   * 计算工作区大小（AsyncGenerator版本，使用队列避免深度递归）
   * 通过AsyncGenerator实现非阻塞计算，并实时返回进度
   * @returns AsyncGenerator，yield进度信息，return最终大小（字节）
   */
  async *calculateWorkspaceSize(): AsyncGenerator<WorkspaceSizeProgressEvent, number, unknown> {
    // 获取要计算的目标工作区路径
    const workspaceDir = await this.getRootWorkspacePath();

    const batchSize = 50;

    let processedFiles = 0; // 已处理文件计数
    let processedDirs = 0; // 已处理目录计数
    let currentSize = 0; // 当前计算的总大小（字节）
    let processedInBatch = 0; // 当前批次已处理项目数

    // 使用队列模式遍历目录，避免深度递归导致栈溢出
    const queue: string[] = [workspaceDir];

    while (queue.length > 0) {
      const currentDir = queue.shift()!; // 取出队列头部的目录进行处理

      try {
        const items = await fs.readdir(currentDir); // 读取目录内容

        for (const item of items) {
          const itemPath = path.join(currentDir, item);

          try {
            const stats = await fs.stat(itemPath); // 获取文件/目录的统计信息

            if (stats.isFile()) {
              // 如果是文件，累加大小并增加文件计数
              currentSize += stats.size;
              processedFiles++;
            } else if (stats.isDirectory()) {
              // 如果是目录，增加目录计数，并将目录加入队列等待后续处理
              processedDirs++;
              queue.push(itemPath);
            }

            processedInBatch++;

            // 批处理控制：每处理完一批项目，就让出事件循环控制权
            if (processedInBatch >= batchSize) {
              // yield当前的进度信息
              yield {
                type: 'progress',
                processedFiles,
                processedDirs,
                currentSize,
                currentPath: itemPath,
                formattedSize: formatSize(currentSize)
              } as WorkspaceSizeProgressEvent;

              // 使用setImmediate让出事件循环，避免长时间阻塞UI
              await new Promise((resolve) => setImmediate(resolve));
              processedInBatch = 0; // 重置批处理计数
            }
          } catch (statError) {
            // 单个文件/目录访问失败不中断整个计算过程
            console.warn(`无法访问: ${itemPath}`, statError);
          }
        }
      } catch (error) {
        // 整个目录读取失败，记录错误并继续
        console.error(`无法读取目录: ${currentDir}`, error);
      }
    }

    // 最终完成报告：yield最终的计算结果
    yield {
      type: 'complete',
      processedFiles,
      processedDirs,
      currentSize,
      currentPath: workspaceDir,
      formattedSize: formatSize(currentSize),
      totalSize: currentSize
    } as WorkspaceSizeProgressEvent;

    // 返回最终的总大小
    return currentSize;
  }

  /**
   * 扫描工作区文件列表（用于复制前的准备）
   * 使用队列模式遍历目录树，避免深度递归导致栈溢出
   * @param workspacePath 工作区根路径
   * @returns 包含所有文件和目录信息的列表
   */
  private async scanWorkspaceFiles(workspacePath: string): Promise<FileCopyInfo[]> {
    const files: FileCopyInfo[] = [];
    const queue: string[] = [workspacePath]; // 待处理目录队列

    // 使用队列模式遍历，避免递归深度过大
    while (queue.length > 0) {
      const currentDir = queue.shift()!; // 取出队列头部的目录

      try {
        // 读取当前目录下的所有项目
        const items = await fs.readdir(currentDir);

        // 遍历目录中的每个项目
        for (const item of items) {
          const itemPath = path.join(currentDir, item);

          try {
            // 获取文件/目录的统计信息
            const stats = await fs.stat(itemPath);
            // 计算相对于工作区根目录的相对路径
            const relativePath = path.relative(workspacePath, itemPath);

            if (stats.isFile()) {
              // 添加文件信息到列表
              files.push({
                sourcePath: itemPath,
                targetPath: relativePath,
                size: stats.size,
                isDirectory: false
              });
            } else if (stats.isDirectory()) {
              // 添加目录信息到列表
              files.push({
                sourcePath: itemPath,
                targetPath: relativePath,
                size: 0, // 目录大小为0
                isDirectory: true
              });
              // 将子目录添加到队列中，等待后续处理
              queue.push(itemPath);
            }
          } catch (statError) {
            // 单个文件访问失败不影响整体扫描（可能是权限问题）
            console.warn(`无法访问文件: ${itemPath}`, statError);
          }
        }
      } catch (error) {
        // 目录读取失败，记录错误但继续处理其他目录
        console.error(`无法读取目录: ${currentDir}`, error);
      }
    }

    return files;
  }

  /**
   * 计算复制速度和剩余时间
   * 基于已复制的数据量和已用时间计算实时统计信息
   * @param copiedSize 已复制大小（字节）
   * @param totalSize 总大小（字节）
   * @param startTime 开始时间戳（毫秒）
   * @returns 包含速度、剩余时间、百分比等统计信息的对象
   */
  private calculateCopyStats(copiedSize: number, totalSize: number, startTime: number) {
    const elapsedTime = (Date.now() - startTime) / 1000; // 已用时间（秒）
    const speed = elapsedTime > 0 ? copiedSize / elapsedTime : 0; // 复制速度（bytes/s）
    const remainingSize = totalSize - copiedSize; // 剩余大小（字节）
    const estimatedTimeRemaining = speed > 0 ? remainingSize / speed : 0; // 预估剩余时间（秒）
    const percentage = totalSize > 0 ? (copiedSize / totalSize) * 100 : 0; // 完成百分比

    return {
      speed, // 原始速度值（bytes/s）
      estimatedTimeRemaining, // 剩余时间（秒）
      percentage, // 完成百分比（0-100）
      formattedSpeed: formatSize(speed) + '/s', // 格式化的速度字符串
      elapsedTime // 已用时间（秒）
    };
  }

  /**
   * 完整复制工作区
   * 使用AsyncGenerator实现流式复制，支持实时进度反馈和非阻塞执行
   * 复制过程分为：扫描 -> 复制 -> 验证（可选）-> 完成
   * @param targetWorkspacePath 目标工作区路径
   * @returns AsyncGenerator，yield进度信息，return最终结果（true=成功，false=失败）
   */
  async *copyWorkspace(targetWorkspacePath: string): AsyncGenerator<WorkspaceCopyProgressEvent, boolean, unknown> {
    const batchSize = 10;
    const startTime = Date.now(); // 记录开始时间，用于计算速度
    let copiedFiles = 0; // 已复制文件计数
    let copiedDirs = 0; // 已复制目录计数
    let copiedSize = 0; // 已复制大小（字节）
    let processedInBatch = 0; // 当前批次已处理项目数

    try {
      // 确定源和目标路径，优先使用自定义路径
      const sourceWorkspacePath = await this.getRootWorkspacePath();

      // 检查源路径是否存在
      if (!fs.existsSync(sourceWorkspacePath)) {
        yield {
          type: 'error',
          error: `源工作区路径不存在: ${sourceWorkspacePath}`,
          copiedFiles: 0,
          copiedDirs: 0,
          copiedSize: 0
        } as WorkspaceCopyProgressEvent;
        return false;
      }

      // 检查目标目录是否为空
      if (fs.existsSync(targetWorkspacePath)) {
        const isEmpty = await isDirectoryEmpty(targetWorkspacePath);
        if (!isEmpty) {
          yield {
            type: 'error',
            error: `目标工作区路径不为空，无法复制: ${targetWorkspacePath}`,
            copiedFiles: 0,
            copiedDirs: 0,
            copiedSize: 0
          } as WorkspaceCopyProgressEvent;
          return false;
        }
      }

      // 确保目标目录存在
      await mkdirp(targetWorkspacePath);

      // 扫描阶段：分析源工作区的文件结构
      yield {
        type: 'scanning',
        copiedFiles: 0,
        copiedDirs: 0,
        copiedSize: 0
      } as WorkspaceCopyProgressEvent;

      // 扫描所有文件和目录，获取完整的文件列表
      const fileList = await this.scanWorkspaceFiles(sourceWorkspacePath);
      const totalFiles = fileList.filter((f) => !f.isDirectory).length; // 统计文件总数
      const totalDirs = fileList.filter((f) => f.isDirectory).length; // 统计目录总数
      const totalSize = fileList.reduce((sum, f) => sum + f.size, 0); // 计算总大小

      // 复制阶段：逐个复制文件和目录
      for (const fileInfo of fileList) {
        const targetPath = path.join(targetWorkspacePath, fileInfo.targetPath);

        try {
          if (fileInfo.isDirectory) {
            // 创建目录结构
            await mkdirp(targetPath);
            copiedDirs++;
          } else {
            // 处理文件复制
            if (fs.existsSync(targetPath)) {
              // 跳过已存在的文件（不覆盖模式）
              copiedFiles++;
              copiedSize += fileInfo.size;
            } else {
              // 确保目标目录存在，然后复制文件
              await mkdirp(path.dirname(targetPath));
              await fs.copy(fileInfo.sourcePath, targetPath, { overwrite: false });
              copiedFiles++;
              copiedSize += fileInfo.size;
            }
          }

          processedInBatch++;

          // 批处理控制：定期让出事件循环控制权并报告进度
          if (processedInBatch >= batchSize) {
            const stats = this.calculateCopyStats(copiedSize, totalSize, startTime);

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
            } as WorkspaceCopyProgressEvent;

            // 让出事件循环控制权，避免长时间阻塞
            await new Promise((resolve) => setImmediate(resolve));
            processedInBatch = 0;
          }
        } catch (copyError) {
          // 单个文件复制失败不中断整个过程，记录错误继续处理
          console.error(`复制文件失败: ${fileInfo.sourcePath} -> ${targetPath}`, copyError);
        }
      }

      // 完成阶段：计算最终统计信息并返回成功
      const finalStats = this.calculateCopyStats(copiedSize, totalSize, startTime);
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
      } as WorkspaceCopyProgressEvent;

      return true; // 复制成功
    } catch (error) {
      // 捕获复制过程中的任何未处理错误
      yield {
        type: 'error',
        error: `复制过程中发生错误: ${error instanceof Error ? error.message : String(error)}`,
        copiedFiles,
        copiedDirs,
        copiedSize
      } as WorkspaceCopyProgressEvent;
      return false; // 复制失败
    }
  }

  /**
   * 清理旧工作区
   * 安全删除指定的工作区目录及其所有内容
   * @param workspacePath 要清理的工作区路径
   * @returns Promise<boolean>，true表示清理成功，false表示清理失败
   */
  async cleanupWorkspace(workspacePath: string): Promise<boolean> {
    try {
      // 检查目录是否存在
      if (fs.existsSync(workspacePath)) {
        // 递归删除整个目录树
        await fs.remove(workspacePath);
        return true;
      }
      // 目录不存在也视为清理成功
      return true;
    } catch (error) {
      // 记录清理失败的错误信息
      console.error(`清理工作区失败: ${workspacePath}`, error);
      return false;
    }
  }
}

export const workspaceManager = new WorkspaceManager();
export default workspaceManager;
