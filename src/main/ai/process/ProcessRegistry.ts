/**
 * ProcessRegistry — 后台进程注册表
 *
 * 跟踪所有通过 exec 工具启动的后台进程。
 * 提供进程查询、输出读取、输入发送、终止等管理能力。
 *
 * 设计：
 *   - 单例模式（全局唯一）
 *   - 每个进程有唯一 processId
 *   - 进程输出保存在环形缓冲区（防止内存爆炸）
 *   - 系统退出时 cleanup() 杀死所有托管进程
 */

import type { ChildProcess } from 'node:child_process'
import { log } from '@main/common/logger'

// ==================== 类型定义 ====================

/** 进程状态 */
export type ProcessStatus = 'running' | 'exited' | 'killed' | 'error'

/** 注册的进程信息 */
export interface ManagedProcess {
  /** 唯一进程 ID（非 OS pid） */
  processId: string
  /** 执行的命令 */
  command: string
  /** 工作目录 */
  cwd: string
  /** OS 进程 PID */
  pid: number | undefined
  /** 进程状态 */
  status: ProcessStatus
  /** 启动时间（ms timestamp） */
  startedAt: number
  /** 结束时间（ms timestamp，仅已结束的进程有） */
  endedAt?: number
  /** 退出码（仅已结束的进程有） */
  exitCode?: number | null
}

/** 进程列表项（暴露给 LLM） */
export interface ProcessListItem {
  processId: string
  command: string
  cwd: string
  pid: number | undefined
  status: ProcessStatus
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  /** 运行时长（ms） */
  runningMs: number
}

/** 内部进程记录 */
interface ProcessEntry {
  info: ManagedProcess
  /** Node.js ChildProcess 引用 */
  child: ChildProcess
  /** 输出缓冲区（stdout + stderr 合并，最近 N 字节） */
  outputBuffer: string[]
  /** 输出总字节数 */
  outputBytes: number
}

// ==================== 常量 ====================

/** 输出缓冲区最大行数 */
const MAX_OUTPUT_LINES = 1000

/** 输出缓冲区最大字节数 */
const MAX_OUTPUT_BYTES = 500_000

/** 最大同时托管进程数（包含已结束但未 prune 的） */
const MAX_PROCESSES = 20

// ==================== 单例 ====================

let instance: ProcessRegistry | null = null

// ==================== 类定义 ====================

export class ProcessRegistry {
  private processes = new Map<string, ProcessEntry>()
  private nextId = 1

  // ---- 单例 ----

  static getInstance(): ProcessRegistry {
    if (!instance) {
      instance = new ProcessRegistry()
    }
    return instance
  }

  static resetInstance(): void {
    if (instance) {
      instance.cleanup()
      instance = null
    }
  }

  // ---- 注册 ----

  /**
   * 注册一个后台进程
   *
   * @returns 分配的 processId
   * @throws 当进程数量达到 MAX_PROCESSES 上限时抛出错误
   */
  register(command: string, cwd: string, child: ChildProcess): string {
    // 先尝试自动 prune 已结束的进程腾出空间
    if (this.processes.size >= MAX_PROCESSES) {
      this.prune()
    }

    // prune 后仍然超限则拒绝注册
    if (this.processes.size >= MAX_PROCESSES) {
      // 杀掉刚 spawn 的子进程，防止泄漏
      child.kill('SIGTERM')
      throw new Error(
        `Process limit reached (max ${MAX_PROCESSES}). ` +
          `Kill existing processes before starting new ones.`
      )
    }

    const processId = `proc-${this.nextId++}`

    const entry: ProcessEntry = {
      info: {
        processId,
        command,
        cwd,
        pid: child.pid,
        status: 'running',
        startedAt: Date.now()
      },
      child,
      outputBuffer: [],
      outputBytes: 0
    }

    // 收集 stdout
    child.stdout?.on('data', (data: Buffer) => {
      this.appendOutput(processId, data.toString('utf-8'))
    })

    // 收集 stderr
    child.stderr?.on('data', (data: Buffer) => {
      this.appendOutput(processId, data.toString('utf-8'))
    })

    // 监听退出
    child.on('close', (code: number | null, signal: string | null) => {
      const proc = this.processes.get(processId)
      if (proc) {
        // 保留 error 状态，不被子进程正常退出覆盖
        if (proc.info.status !== 'error') {
          proc.info.status = signal ? 'killed' : 'exited'
        }
        proc.info.endedAt = Date.now()
        proc.info.exitCode = code
      }
    })

    child.on('error', (err: Error) => {
      const proc = this.processes.get(processId)
      if (proc) {
        proc.info.status = 'error'
        proc.info.endedAt = Date.now()
        this.appendOutput(processId, `[Error] ${err.message}\n`)
      }
    })

    this.processes.set(processId, entry)
    log.info(`[ProcessRegistry] Registered: ${processId} (pid=${child.pid}) — ${command}`)

    return processId
  }

  // ---- 查询 ----

  /** 列出所有进程 */
  list(): ProcessListItem[] {
    const now = Date.now()
    return Array.from(this.processes.values()).map((entry) => ({
      processId: entry.info.processId,
      command: entry.info.command,
      cwd: entry.info.cwd,
      pid: entry.info.pid,
      status: entry.info.status,
      startedAt: entry.info.startedAt,
      endedAt: entry.info.endedAt,
      exitCode: entry.info.exitCode,
      runningMs: (entry.info.endedAt ?? now) - entry.info.startedAt
    }))
  }

  /** 获取单个进程信息 */
  get(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId)?.info
  }

  /** 读取进程输出（最近 N 行） */
  readOutput(processId: string, lastN?: number): string | undefined {
    const entry = this.processes.get(processId)
    if (!entry) return undefined

    const lines = entry.outputBuffer
    if (lastN && lastN > 0 && lastN < lines.length) {
      return lines.slice(-lastN).join('')
    }
    return lines.join('')
  }

  // ---- 交互 ----

  /** 向进程 stdin 发送输入 */
  sendInput(processId: string, input: string): boolean {
    const entry = this.processes.get(processId)
    if (!entry || entry.info.status !== 'running' || !entry.child.stdin) {
      return false
    }
    entry.child.stdin.write(input)
    return true
  }

  /** 向进程发送信号（如 SIGINT = Ctrl+C） */
  sendSignal(processId: string, signal: NodeJS.Signals = 'SIGINT'): boolean {
    const entry = this.processes.get(processId)
    if (!entry || entry.info.status !== 'running') {
      return false
    }
    return entry.child.kill(signal)
  }

  /** 终止进程 */
  kill(processId: string): boolean {
    const entry = this.processes.get(processId)
    if (!entry || entry.info.status !== 'running') {
      return false
    }
    const killed = entry.child.kill('SIGTERM')
    // 如果 SIGTERM 不够，3 秒后 SIGKILL
    if (killed) {
      setTimeout(() => {
        const proc = this.processes.get(processId)
        if (proc && proc.info.status === 'running') {
          proc.child.kill('SIGKILL')
        }
      }, 3000)
    }
    return killed
  }

  // ---- 清理 ----

  /** 清理所有进程（系统退出时调用） */
  cleanup(): void {
    let killed = 0
    for (const [id, entry] of this.processes) {
      if (entry.info.status === 'running') {
        entry.child.kill('SIGTERM')
        killed++
        log.info(`[ProcessRegistry] Cleanup: killing ${id} (pid=${entry.info.pid})`)
      }
    }
    if (killed > 0) {
      log.info(`[ProcessRegistry] Cleanup: killed ${killed} running processes`)
    }
    this.processes.clear()
  }

  /** 移除已结束的进程记录 */
  prune(): number {
    let pruned = 0
    for (const [id, entry] of this.processes) {
      if (entry.info.status !== 'running') {
        this.processes.delete(id)
        pruned++
      }
    }
    return pruned
  }

  /** 进程数量 */
  get size(): number {
    return this.processes.size
  }

  /** 运行中的进程数量 */
  get runningCount(): number {
    let count = 0
    for (const entry of this.processes.values()) {
      if (entry.info.status === 'running') count++
    }
    return count
  }

  // ---- 内部 ----

  private appendOutput(processId: string, text: string): void {
    const entry = this.processes.get(processId)
    if (!entry) return

    // 按行拆分并追加
    const lines = text.split('\n').filter((l) => l.length > 0)
    for (const line of lines) {
      entry.outputBuffer.push(line + '\n')
      entry.outputBytes += line.length + 1
    }

    // 环形缓冲：超限时裁剪前半部分
    if (entry.outputBuffer.length > MAX_OUTPUT_LINES) {
      const excess = entry.outputBuffer.length - MAX_OUTPUT_LINES
      const removed = entry.outputBuffer.splice(0, excess)
      entry.outputBytes -= removed.reduce((sum, l) => sum + l.length, 0)
    }

    if (entry.outputBytes > MAX_OUTPUT_BYTES) {
      // 暴力裁剪一半
      const half = Math.floor(entry.outputBuffer.length / 2)
      const removed = entry.outputBuffer.splice(0, half)
      entry.outputBytes -= removed.reduce((sum, l) => sum + l.length, 0)
    }
  }
}
