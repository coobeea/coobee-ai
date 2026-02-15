/**
 * session_history — 对话历史摘要
 *
 * 查看当前会话的 LLM 调用时间线：
 *   - 每次调用的时间、模型、耗时
 *   - 用户消息摘要
 *   - 工具调用次数
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

/** 最大返回条目数 */
const MAX_ENTRIES = 50

export const sessionHistoryTool: ToolDefinition = {
  name: 'session_history',
  description:
    'View conversation history timeline: each LLM call with timestamp, model, duration, ' +
    'user message summary, and tool call count. ' +
    'Use this to review what happened in the session.',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: z.object({
    limit: z.number().optional().describe(`Maximum entries to return. Defaults to ${MAX_ENTRIES}`)
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: { workspaceRoot: string; sessionId?: string }
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    yield { type: 'progress' as const, content: '[session_history] scanning...' }

    const workspace = context?.workspaceRoot
    if (!workspace) {
      return { success: false, llmContent: 'Error: workspace not available in context.' }
    }

    const limit = Math.min((params.limit as number) || MAX_ENTRIES, MAX_ENTRIES)
    const contextsDir = path.join(workspace, 'contexts')

    if (!fs.existsSync(contextsDir)) {
      return { success: true, llmContent: 'No conversation history yet.' }
    }

    const files = fs
      .readdirSync(contextsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()

    if (files.length === 0) {
      return { success: true, llmContent: 'No conversation history yet.' }
    }

    // 取最近 N 条
    const recentFiles = files.slice(-limit)

    const lines: string[] = [`Session history (${recentFiles.length}/${files.length} entries):`, '']

    for (let i = 0; i < recentFiles.length; i++) {
      try {
        const raw = fs.readFileSync(path.join(contextsDir, recentFiles[i]), 'utf-8')
        const snap = JSON.parse(raw)

        const time = snap.timestamp ? new Date(snap.timestamp).toLocaleTimeString() : '?'
        const model = snap.config?.model || '?'
        const dur = snap.duration !== undefined ? `${snap.duration}ms` : '?'
        const tools = snap.toolCalls?.length || 0
        const msg = snap.userMessage
          ? snap.userMessage.length > 60
            ? snap.userMessage.slice(0, 60) + '...'
            : snap.userMessage
          : '(no message)'

        lines.push(`#${i + 1} [${time}] model=${model} dur=${dur} tools=${tools}`)
        lines.push(`   > ${msg}`)
      } catch {
        lines.push(`#${i + 1} [${recentFiles[i]}] (parse error)`)
      }
    }

    return { success: true, llmContent: lines.join('\n') }
  }
}
