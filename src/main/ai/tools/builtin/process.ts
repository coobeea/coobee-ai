/**
 * process — 后台进程管理工具
 *
 * 管理通过 exec（background: true）启动的后台进程。
 *
 * 操作：
 *   - list:        列出所有后台进程（运行中 + 已结束）
 *   - read_output: 读取指定进程的输出（最近 N 行）
 *   - send_input:  向进程 stdin 发送输入
 *   - send_signal: 向进程发送信号（如 SIGINT = Ctrl+C）
 *   - kill:        终止进程（SIGTERM，3s 后 SIGKILL）
 *
 * 分类：Execute | 风险：中（管理已有进程，不执行新命令）
 */

import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'
import { ProcessRegistry } from '../../process/ProcessRegistry'

export const processTool: ToolDefinition = {
  name: 'process',
  description:
    'Manage background processes started by exec(background=true).\n' +
    'Actions:\n' +
    '- list: show all background processes\n' +
    '- read_output: read recent output from a process\n' +
    '- send_input: send text to process stdin\n' +
    '- send_signal: send a signal (e.g. SIGINT for Ctrl+C)\n' +
    '- kill: terminate a process',
  category: ToolCategory.Execute,
  needUserConfirm: false,
  parameters: z.object({
    action: z
      .enum(['list', 'read_output', 'send_input', 'send_signal', 'kill'])
      .describe('The action to perform'),
    processId: z
      .string()
      .optional()
      .describe('Target process ID (required for all actions except list)'),
    input: z.string().optional().describe('Text to send (for send_input action)'),
    signal: z
      .string()
      .optional()
      .describe('Signal name (for send_signal action, e.g. SIGINT, SIGTERM). Defaults to SIGINT'),
    lastN: z
      .number()
      .optional()
      .describe('Number of recent output lines to return (for read_output). Defaults to all')
  }),

  execute: async function* (
    params: Record<string, unknown>
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string
    const processId = params.processId as string | undefined
    const input = params.input as string | undefined
    const signalName = params.signal as string | undefined
    const lastN = params.lastN as number | undefined

    const registry = ProcessRegistry.getInstance()

    yield { type: 'progress' as const, content: `[process] action=${action}` }

    // ==================== list ====================
    if (action === 'list') {
      const processes = registry.list()

      if (processes.length === 0) {
        return {
          success: true,
          llmContent: 'No background processes.'
        }
      }

      const lines = processes.map((p) => {
        const status = p.status === 'running' ? '🟢 running' : `⏹ ${p.status}`
        const runtime =
          p.status === 'running'
            ? `${Math.round(p.runningMs / 1000)}s`
            : `${Math.round(p.runningMs / 1000)}s (ended)`
        const exit = p.exitCode !== undefined && p.exitCode !== null ? ` exit=${p.exitCode}` : ''
        return `${p.processId} | ${status} | pid=${p.pid} | ${runtime}${exit} | ${p.command}`
      })

      return {
        success: true,
        llmContent: `Background processes (${processes.length}):\n\n${lines.join('\n')}`
      }
    }

    // ---- 以下操作需要 processId ----
    if (!processId) {
      return {
        success: false,
        llmContent: `Error: processId is required for action "${action}"`,
        error: { code: 'MISSING_PARAM', message: 'processId is required' }
      }
    }

    const proc = registry.get(processId)
    if (!proc) {
      return {
        success: false,
        llmContent: `Error: process "${processId}" not found. Use action "list" to see available processes.`,
        error: { code: 'NOT_FOUND', message: `Process ${processId} not found` }
      }
    }

    // ==================== read_output ====================
    if (action === 'read_output') {
      const output = registry.readOutput(processId, lastN)

      if (!output || output.trim().length === 0) {
        return {
          success: true,
          llmContent: `Process ${processId} (${proc.status}): no output yet.`
        }
      }

      const header = `Process ${processId} (${proc.status}, pid=${proc.pid}):\n`
      return {
        success: true,
        llmContent: header + output
      }
    }

    // ==================== send_input ====================
    if (action === 'send_input') {
      if (!input) {
        return {
          success: false,
          llmContent: 'Error: input is required for send_input action',
          error: { code: 'MISSING_PARAM', message: 'input is required' }
        }
      }

      if (proc.status !== 'running') {
        return {
          success: false,
          llmContent: `Error: process ${processId} is not running (status: ${proc.status})`,
          error: { code: 'NOT_RUNNING', message: 'Process is not running' }
        }
      }

      const sent = registry.sendInput(processId, input + '\n')
      return {
        success: sent,
        llmContent: sent
          ? `Sent input to ${processId}: "${input}"`
          : `Failed to send input to ${processId}`
      }
    }

    // ==================== send_signal ====================
    if (action === 'send_signal') {
      if (proc.status !== 'running') {
        return {
          success: false,
          llmContent: `Error: process ${processId} is not running (status: ${proc.status})`,
          error: { code: 'NOT_RUNNING', message: 'Process is not running' }
        }
      }

      const sig = (signalName || 'SIGINT') as NodeJS.Signals
      const sent = registry.sendSignal(processId, sig)
      return {
        success: sent,
        llmContent: sent
          ? `Signal ${sig} sent to ${processId} (pid=${proc.pid})`
          : `Failed to send signal to ${processId}`
      }
    }

    // ==================== kill ====================
    if (action === 'kill') {
      if (proc.status !== 'running') {
        return {
          success: true,
          llmContent: `Process ${processId} is already ${proc.status} (exit=${proc.exitCode})`
        }
      }

      const killed = registry.kill(processId)
      return {
        success: killed,
        llmContent: killed
          ? `Process ${processId} (pid=${proc.pid}) is being terminated (SIGTERM, SIGKILL after 3s)`
          : `Failed to kill ${processId}`
      }
    }

    // ---- 未知 action ----
    return {
      success: false,
      llmContent: `Unknown action: "${action}". Valid actions: list, read_output, send_input, send_signal, kill`,
      error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` }
    }
  }
}
