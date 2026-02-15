/**
 * exec — Shell 命令执行工具
 *
 * 在系统 shell 中执行命令，支持前台和后台两种模式。
 *
 * 前台模式（默认）：
 *   - 等待命令完成，返回 stdout/stderr 和退出码
 *   - 通过 AsyncGenerator 实时流式输出
 *   - 超时自动终止
 *
 * 后台模式（background: true）：
 *   - 立即返回 processId，进程在后台运行
 *   - 通过 process 工具管理（查看输出、发送输入、终止）
 *   - 适用于 dev server、watch 任务等长进程
 *
 * 安全：
 *   - 工作目录限制在 workspaceRoot 内
 *   - 支持 AbortSignal 取消
 *   - 超时自动终止（前台模式）
 *   - 命令安全策略（黑名单/白名单）由 HITL 审批层处理，工具层不参与安全判断
 *   - HITL 审批由上层 AgentExecutor 统一编排
 *
 * 分类：Execute | 风险：高（可执行任意系统命令）
 */
import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolCategory } from '../types'
import { resolveWorkingDirectory } from '../../sandbox'
import { ProcessRegistry } from '../../process/ProcessRegistry'

/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 最大输出字节数（约 100KB，防止 token 爆炸） */
const MAX_OUTPUT_BYTES = 100_000

export const execTool: ToolDefinition = {
  name: 'exec',
  description:
    'Execute a shell command. Supports two modes:\n' +
    '- Foreground (default): waits for completion, returns stdout/stderr/exit code.\n' +
    '- Background (background=true): starts the process in background, returns a processId immediately. ' +
    'Use the `process` tool to manage background processes (read output, send input, kill).\n' +
    'Use background mode for long-running tasks like dev servers, watchers, or builds.',
  category: ToolCategory.Execute,
  needUserConfirm: true,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    background: z
      .boolean()
      .optional()
      .describe(
        'Run in background mode. Returns processId immediately. Use `process` tool to manage.'
      ),
    timeout: z
      .number()
      .optional()
      .describe(
        `Timeout in milliseconds (foreground only). Defaults to ${DEFAULT_TIMEOUT_MS}ms (${DEFAULT_TIMEOUT_MS / 1000}s)`
      )
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const command = params.command as string
    const background = params.background as boolean | undefined
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

    // ==================== 后台模式 ====================
    if (background) {
      yield { type: 'progress', content: `[background] $ ${command}`, percentage: 0 }

      const child = spawn(command, {
        shell: true,
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false // 不脱离父进程，确保可管理
      })

      // 注册到 ProcessRegistry
      const registry = ProcessRegistry.getInstance()
      const processId = registry.register(command, cwd, child)

      const llmContent =
        `Process started in background.\n` +
        `processId: ${processId}\n` +
        `pid: ${child.pid}\n` +
        `command: ${command}\n` +
        `cwd: ${cwd}\n\n` +
        `Use the \`process\` tool to manage this process:\n` +
        `- process({ action: "read_output", processId: "${processId}" }) — read output\n` +
        `- process({ action: "send_input", processId: "${processId}", input: "..." }) — send input\n` +
        `- process({ action: "kill", processId: "${processId}" }) — terminate`

      yield {
        type: 'output',
        content: `Background process started: ${processId} (pid=${child.pid})`
      }

      return {
        success: true,
        llmContent,
        userContent: `Background: ${command} (${processId}, pid=${child.pid})`,
        metadata: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          processId,
          pid: child.pid,
          background: true,
          cwd
        }
      }
    }

    // ==================== 前台模式 ====================
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
        cwd,
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
