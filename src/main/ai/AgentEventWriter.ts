/**
 * Agent 事件写入器
 *
 * 将 StreamChunk 追加写入 events.jsonl 文件。
 * 每个 session 一个文件，所有执行的事件按时间线累积。
 * JSONL 格式：每行一个 JSON 对象，便于 grep/分析。
 *
 * 从 AgentExecutor 中提取，专注于事件持久化职责。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@main/common/logger'
import type { StreamChunk } from './runtime/types'

const log = createLogger('event-writer')

export class AgentEventWriter {
  private eventsFile: string | null

  constructor(workspace: string | undefined) {
    this.eventsFile = workspace ? path.join(workspace, 'events', 'events.jsonl') : null
  }

  /** 追加写入一个事件 */
  append(chunk: StreamChunk, seq: number): void {
    if (!this.eventsFile) return
    try {
      // 确保目录存在（首次写入时创建）
      const dir = path.dirname(this.eventsFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const line = JSON.stringify({
        ts: new Date().toISOString(),
        seq,
        type: chunk.type,
        content: chunk.content,
        ...(chunk.data ? { data: chunk.data } : {})
      })
      fs.appendFileSync(this.eventsFile, line + '\n')
    } catch (err) {
      log.warn(`[AgentEventWriter] Write failed (seq=${seq}):`, err)
    }
  }

  /** 事件文件路径（可能为 null） */
  get filePath(): string | null {
    return this.eventsFile
  }
}
