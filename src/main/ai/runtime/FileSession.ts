/**
 * FileSession — 单层 Session 持久化
 *
 * 直接实现 SDK Session 接口 + JSONL 文件存储。
 * 直接存储 SDK 的 AgentInputItem，零转换。
 *
 * 存储路径：{basePath}/sessions/{sessionId}/messages.jsonl
 */

import type { Session, AgentInputItem } from '@openai/agents'
import { mkdir, writeFile, readFile, truncate } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'

/**
 * 基于文件的 Session 实现
 *
 * 将 SDK AgentInputItem 以 JSONL 格式直接持久化到磁盘。
 * - getItems()：从文件读取历史，返回 AgentInputItem[]
 * - addItems()：追加 AgentInputItem[] 到文件
 * - popItem()：移除并返回最后一条记录
 * - clearSession()：清空文件内容
 */
export class FileSession implements Session {
  private readonly filePath: string
  private initialized = false

  /**
   * @param sessionId 会话 ID
   * @param basePath 存储根路径（默认使用 Electron userData）
   */
  constructor(
    private readonly sessionId: string,
    basePath?: string
  ) {
    const base = basePath || FileSession.getDefaultBasePath()
    this.filePath = join(base, 'sessions', sessionId, 'messages.jsonl')
  }

  /**
   * 获取默认存储路径
   * 在 Electron 环境下使用 app.getPath('userData')
   * 在测试环境下 fallback 到临时目录
   */
  private static getDefaultBasePath(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      return app.getPath('userData')
    } catch {
      // 非 Electron 环境（测试等），使用临时目录
      return join(process.env.HOME || '/tmp', '.coobee-ai')
    }
  }

  /**
   * 确保目录和文件存在
   */
  private async ensureFile(): Promise<void> {
    if (this.initialized) return

    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    if (!existsSync(this.filePath)) {
      await writeFile(this.filePath, '', 'utf-8')
    }
    this.initialized = true
  }

  // ========== SDK Session 接口实现 ==========

  async getSessionId(): Promise<string> {
    return this.sessionId
  }

  /**
   * 获取对话历史
   * SDK 在每次 run() 前调用此方法获取上下文
   */
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    await this.ensureFile()

    try {
      const content = await readFile(this.filePath, 'utf-8')
      const items = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as AgentInputItem)

      return limit ? items.slice(-limit) : items
    } catch {
      return []
    }
  }

  /**
   * 追加新的对话项
   * SDK 在每次 run() 后调用此方法保存新消息
   */
  async addItems(items: AgentInputItem[]): Promise<void> {
    await this.ensureFile()

    const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n'
    await writeFile(this.filePath, lines, { flag: 'a' })
  }

  /**
   * 弹出最后一条记录
   * SDK 在某些场景下需要此功能（如撤销最后一条）
   */
  async popItem(): Promise<AgentInputItem | undefined> {
    await this.ensureFile()

    try {
      const content = await readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim())

      if (lines.length === 0) return undefined

      const lastItem = JSON.parse(lines[lines.length - 1]) as AgentInputItem
      const remaining = lines.slice(0, -1)

      // 重写文件（去掉最后一行）
      await writeFile(
        this.filePath,
        remaining.length > 0 ? remaining.join('\n') + '\n' : '',
        'utf-8'
      )

      return lastItem
    } catch {
      return undefined
    }
  }

  /**
   * 清空会话
   */
  async clearSession(): Promise<void> {
    await this.ensureFile()

    try {
      await truncate(this.filePath, 0)
    } catch {
      // 文件可能不存在，忽略
      await writeFile(this.filePath, '', 'utf-8')
    }
  }

  // ========== 辅助方法 ==========

  /**
   * 获取消息数量
   */
  async getItemCount(): Promise<number> {
    const items = await this.getItems()
    return items.length
  }

  /**
   * 获取文件路径（用于调试）
   */
  getFilePath(): string {
    return this.filePath
  }
}
