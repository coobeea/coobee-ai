/**
 * session_status — 当前会话状态查询
 *
 * 让 Agent 自我感知当前会话的运行状态：
 *   - 会话 ID、运行时长
 *   - contexts/ 快照数量
 *   - 最近一次 LLM 调用的 token 用量、模型、耗时
 *
 * 数据来源：workspace/contexts/*.json
 *
 * 分类：Observability | 风险：低（只读）
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'

export const sessionStatusTool: ToolDefinition = {
  name: 'session_status',
  description:
    'View current session status: session ID, snapshot count, ' +
    'last LLM call info (model, duration, token usage). ' +
    'Use this for self-monitoring and cost awareness.',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: z.object({}),

  execute: async function* (
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: { workspaceRoot: string; sessionId?: string }
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    yield { type: 'progress' as const, content: '[session_status] querying...' }

    const workspace = context?.workspaceRoot
    if (!workspace) {
      return { success: false, llmContent: 'Error: workspace not available in context.' }
    }

    const contextsDir = path.join(workspace, 'contexts')

    if (!fs.existsSync(contextsDir)) {
      return {
        success: true,
        llmContent: `Session: ${context.sessionId || 'unknown'}\nSnapshots: 0\nNo LLM calls recorded yet.`
      }
    }

    // 列出所有 context JSON 文件
    const files = fs
      .readdirSync(contextsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()

    const snapshotCount = files.length

    // 读取最近一次快照
    let lastInfo = 'No snapshots available.'
    if (files.length > 0) {
      try {
        const lastFile = files[files.length - 1]
        const raw = fs.readFileSync(path.join(contextsDir, lastFile), 'utf-8')
        const snap = JSON.parse(raw)

        const parts: string[] = []
        parts.push(`Last call: ${snap.timestamp || lastFile}`)
        if (snap.config?.model) parts.push(`Model: ${snap.config.model}`)
        if (snap.duration !== undefined) parts.push(`Duration: ${snap.duration}ms`)
        if (snap.toolCalls?.length) parts.push(`Tool calls: ${snap.toolCalls.length}`)
        if (snap.error) parts.push(`Error: ${snap.error}`)
        lastInfo = parts.join('\n')
      } catch {
        lastInfo = 'Failed to parse last snapshot.'
      }
    }

    const output = [
      `Session: ${context.sessionId || 'unknown'}`,
      `Snapshots: ${snapshotCount}`,
      '',
      lastInfo
    ].join('\n')

    return { success: true, llmContent: output }
  }
}
