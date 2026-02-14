/**
 * bash — Shell 命令执行工具
 *
 * 在系统 shell 中执行命令。
 * 通过 AsyncGenerator 实时流式输出 stdout/stderr，前端可即时展示。
 *
 * 安全：
 *   - 工作目录限制在 workspaceRoot 内
 *   - 支持 AbortSignal 取消
 *   - 超时自动终止
 *   - 审批/HITL 由上层统一处理
 *
 * 分类：Execute | 风险：高（可执行任意系统命令）
 */
import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolCategory } from '../types'
import { resolveWorkingDirectory } from '../../sandbox'

/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 最大输出字节数（约 100KB，防止 token 爆炸） */
const MAX_OUTPUT_BYTES = 100_000

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Execute a shell command and return stdout, stderr, and exit code. ' +
    'Use this for running programs, installing packages, running tests, git operations, etc. ' +
    'Commands run in the system default shell within the workspace directory. ' +
    'Long-running commands will be terminated after the timeout.',
  category: ToolCategory.Execute,
  needUserConfirm: true,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    timeout: z
      .number()
      .optional()
      .describe(
        `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}ms (${DEFAULT_TIMEOUT_MS / 1000}s)`
      )
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const command = params.command as string
    const timeout = (params.timeout as number) || DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    if (!command || typeof command !== 'string') {
      return {
        success: false,
        llmContent: 'Error: command must be a non-empty string',
        error: { code: 'INVALID_PARAM', message: 'command must be a non-empty string' }
      }
    }

    // 工作目录：限制在 workspaceRoot 内
    const cwd = resolveWorkingDirectory(context)

    yield { type: 'progress', content: `$ ${command}`, percentage: 0 }

    const result: ToolResult = await new Promise<ToolResult>((resolveResult) => {
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let stdoutTruncated = false
      let stderrTruncated = false
      let timedOut = false

      const child = spawn(command, {
        shell: true,
        timeout,
        cwd, // 在工作区目录内执行
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      // 支持外部取消
      const abortHandler = (): void => {
        child.kill('SIGTERM')
      }
      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      child.stdout.on('data', (data: Buffer) => {
        if (stdoutBytes < MAX_OUTPUT_BYTES) {
          stdout.push(data)
          stdoutBytes += data.length
        } else {
          stdoutTruncated = true
        }
      })

      child.stderr.on('data', (data: Buffer) => {
        if (stderrBytes < MAX_OUTPUT_BYTES) {
          stderr.push(data)
          stderrBytes += data.length
        } else {
          stderrTruncated = true
        }
      })

      child.on('error', (err: Error) => {
        signal?.removeEventListener('abort', abortHandler)
        resolveResult({
          success: false,
          llmContent: `Error executing command: ${err.message}`,
          error: { code: 'EXEC_ERROR', message: err.message },
          metadata: { startTime, endTime: Date.now(), duration: Date.now() - startTime }
        })
      })

      child.on('close', (code: number | null, sig: string | null) => {
        signal?.removeEventListener('abort', abortHandler)

        if (sig === 'SIGTERM') {
          timedOut = true
        }

        let stdoutStr = Buffer.concat(stdout).toString('utf-8')
        let stderrStr = Buffer.concat(stderr).toString('utf-8')

        if (stdoutTruncated) {
          stdoutStr += `\n... [stdout truncated at ${MAX_OUTPUT_BYTES} bytes]`
        }
        if (stderrTruncated) {
          stderrStr += `\n... [stderr truncated at ${MAX_OUTPUT_BYTES} bytes]`
        }

        const parts: string[] = []

        if (timedOut) {
          parts.push(`[Timed out after ${timeout}ms]`)
        }

        parts.push(`Exit code: ${code ?? 'null (killed)'}`)

        if (stdoutStr.trim()) {
          parts.push(`stdout:\n${stdoutStr.trim()}`)
        }
        if (stderrStr.trim()) {
          parts.push(`stderr:\n${stderrStr.trim()}`)
        }

        const llmContent = parts.join('\n\n')
        const duration = Date.now() - startTime
        const success = code === 0 && !timedOut

        resolveResult({
          success,
          llmContent,
          userContent: llmContent,
          error: success
            ? undefined
            : {
                code: timedOut ? 'TIMEOUT' : 'EXIT_CODE',
                message: timedOut ? `Command timed out after ${timeout}ms` : `Exit code: ${code}`
              },
          metadata: {
            startTime,
            endTime: Date.now(),
            duration,
            exitCode: code,
            timedOut,
            stdoutBytes,
            stderrBytes,
            cwd
          }
        })
      })
    })

    // 输出最终结果摘要
    const exitInfo =
      result.metadata?.exitCode === 0 ? 'completed' : `failed (exit ${result.metadata?.exitCode})`
    yield {
      type: 'output',
      content: `Command ${exitInfo} in ${result.metadata?.duration}ms`
    }

    return result
  }
}
