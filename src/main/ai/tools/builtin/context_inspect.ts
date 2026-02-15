/**
 * context_inspect — 历史 LLM 调用上下文查看
 *
 * 查看某次 LLM 调用的完整上下文快照：
 *   - instructions、appendInstructions
 *   - skills、tools 清单
 *   - 用户消息、LLM 输出
 *   - 工具调用详情
 *
 * 数据来源：workspace/contexts/{filename}.json
 *
 * 分类：Observability | 风险：低（只读）
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'

export const contextInspectTool: ToolDefinition = {
  name: 'context_inspect',
  description:
    'Inspect a specific LLM call context snapshot. ' +
    'Shows instructions, skills, tools, user message, output, and tool calls. ' +
    'Use session_history first to find the filename, then inspect details.',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: z.object({
    filename: z
      .string()
      .describe(
        'Context snapshot filename (e.g. "2026-02-14T19-06-50-096.json"). ' +
          'Use "latest" to inspect the most recent call.'
      )
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: { workspaceRoot: string }
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    yield { type: 'progress' as const, content: '[context_inspect] loading...' }

    const workspace = context?.workspaceRoot
    if (!workspace) {
      return { success: false, llmContent: 'Error: workspace not available in context.' }
    }

    let filename = params.filename as string
    const contextsDir = path.join(workspace, 'contexts')

    if (!fs.existsSync(contextsDir)) {
      return { success: false, llmContent: 'No contexts directory found.' }
    }

    // 处理 "latest" 快捷方式
    if (filename === 'latest') {
      const files = fs
        .readdirSync(contextsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
      if (files.length === 0) {
        return { success: false, llmContent: 'No context snapshots found.' }
      }
      filename = files[files.length - 1]
    }

    // 确保文件名以 .json 结尾
    if (!filename.endsWith('.json')) {
      filename = filename + '.json'
    }

    const filePath = path.join(contextsDir, filename)

    if (!fs.existsSync(filePath)) {
      return { success: false, llmContent: `Context snapshot not found: ${filename}` }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const snap = JSON.parse(raw)

      const sections: string[] = []

      // Header
      sections.push(`=== Context Snapshot: ${filename} ===`)
      sections.push(`Timestamp: ${snap.timestamp || '?'}`)
      sections.push(`Session: ${snap.sessionId || '?'}`)
      sections.push(`Runtime: ${snap.runtime || '?'}`)
      if (snap.duration !== undefined) sections.push(`Duration: ${snap.duration}ms`)
      sections.push('')

      // Config
      if (snap.config) {
        sections.push(`--- Config ---`)
        sections.push(`Model: ${snap.config.model || '?'}`)
        sections.push(`Name: ${snap.config.name || '?'}`)
        if (snap.config.instructions) {
          const instr =
            snap.config.instructions.length > 200
              ? snap.config.instructions.slice(0, 200) + '...'
              : snap.config.instructions
          sections.push(`Instructions: ${instr}`)
        }
        sections.push('')
      }

      // Skills
      if (snap.config?.skills?.length) {
        sections.push(`--- Skills (${snap.config.skills.length}) ---`)
        for (const s of snap.config.skills) {
          sections.push(`  - ${s.name}: ${s.description || '(no description)'}`)
        }
        sections.push('')
      }

      // Tools
      if (snap.config?.tools?.length) {
        sections.push(`--- Tools (${snap.config.tools.length}) ---`)
        for (const t of snap.config.tools) {
          sections.push(`  - ${t.name}`)
        }
        sections.push('')
      }

      // User message
      sections.push(`--- User Message ---`)
      sections.push(snap.userMessage || '(empty)')
      sections.push('')

      // Output
      sections.push(`--- LLM Output ---`)
      const output = snap.output || '(empty)'
      sections.push(output.length > 500 ? output.slice(0, 500) + '...(truncated)' : output)
      sections.push('')

      // Tool calls
      if (snap.toolCalls?.length) {
        sections.push(`--- Tool Calls (${snap.toolCalls.length}) ---`)
        for (const tc of snap.toolCalls) {
          sections.push(`  ${tc.toolName}(${JSON.stringify(tc.arguments)})`)
          if (tc.result !== undefined) {
            const resultStr = JSON.stringify(tc.result)
            sections.push(
              `    → ${resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr}`
            )
          }
        }
        sections.push('')
      }

      // Error
      if (snap.error) {
        sections.push(`--- Error ---`)
        sections.push(snap.error)
      }

      return { success: true, llmContent: sections.join('\n') }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, llmContent: `Failed to parse context: ${msg}` }
    }
  }
}
