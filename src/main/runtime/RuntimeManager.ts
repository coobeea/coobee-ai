/**
 * RuntimeManager — Worker 子进程生命周期管理器
 *
 * 职责：
 *   1. 虚拟环境初始化（使用 uv 创建 venv + 安装依赖）
 *   2. 子进程启动/停止（spawn + 信号管理）
 *   3. 健康检查（HTTP GET /health 轮询）
 *   4. 崩溃自动重启（可配置次数上限）
 *   5. 应用退出时优雅关闭所有 Worker
 *
 * 设计原则：
 *   - 不阻塞主进程启动
 *   - Worker 在后台异步初始化
 *   - 状态变更通过事件通知 Renderer
 */

import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createLogger } from '@main/common/logger'
import { Env } from '@main/common/env'
import type { WorkerConfig, WorkerInfo, WorkerStatus } from './types'

const log = createLogger('runtime')

/** 内部 Worker 实例状态 */
interface ManagedWorker {
  config: WorkerConfig
  process: ChildProcess | null
  status: WorkerStatus
  restartCount: number
  error?: string
  /** 标记是否正在主动停止（区分崩溃） */
  stopping: boolean
}

/**
 * RuntimeManager 单例
 *
 * 事件：
 *   - 'worker:status' → WorkerInfo  状态变更
 *   - 'worker:log'    → { name, level, message }  日志输出
 */
export class RuntimeManager extends EventEmitter {
  private static instance: RuntimeManager | null = null

  private workers = new Map<string, ManagedWorker>()
  private configs = new Map<string, WorkerConfig>()
  /** 全局停止标记（app 退出时置 true，阻止自动重启） */
  private shuttingDown = false

  private constructor() {
    super()
  }

  static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) {
      RuntimeManager.instance = new RuntimeManager()
    }
    return RuntimeManager.instance
  }

  // ==================== 配置注册 ====================

  /**
   * 注册 Worker 配置（不立即启动）
   */
  register(config: WorkerConfig): void {
    this.configs.set(config.name, config)

    // 创建初始状态（stopped），并发送事件让前端感知到 Worker 存在
    if (!this.workers.has(config.name)) {
      const worker: ManagedWorker = {
        config,
        process: null,
        status: 'stopped',
        restartCount: 0,
        stopping: false
      }
      this.workers.set(config.name, worker)
      this.updateStatus(worker, 'stopped')
    }

    log.info(`[RuntimeManager] 已注册 Worker: ${config.name} (${config.label})`)
  }

  /**
   * 扫描 workers/ 目录，自动发现并注册所有 Worker
   *
   * 约定：每个 Worker 目录下必须有 worker.json 配置文件。
   * 目录结构：
   *   workers/
   *   ├── tts/
   *   │   ├── worker.json      ← 扫描这个
   *   │   ├── server.py
   *   │   └── requirements.txt
   *   └── asr/
   *       ├── worker.json
   *       └── ...
   *
   * @returns 已注册的 Worker 数量
   */
  scanAndRegister(): number {
    const workersDir = Env.paths.workersDir

    if (!fs.existsSync(workersDir)) {
      log.warn(`[RuntimeManager] Workers 目录不存在: ${workersDir}`)
      return 0
    }

    const entries = fs.readdirSync(workersDir, { withFileTypes: true })
    let count = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const configPath = path.join(workersDir, entry.name, 'worker.json')
      if (!fs.existsSync(configPath)) {
        log.debug(`[RuntimeManager] 跳过 ${entry.name}/（无 worker.json）`)
        continue
      }

      try {
        const raw = fs.readFileSync(configPath, 'utf-8')
        const config = JSON.parse(raw) as WorkerConfig

        // 用目录名兜底 name 字段
        if (!config.name) {
          config.name = entry.name
        }

        // enable 默认 true；显式 false 时跳过
        if (config.enable === false) {
          log.info(`[RuntimeManager] 跳过已禁用的 Worker: ${config.name}`)
          continue
        }

        this.register(config)
        count++
      } catch (err) {
        log.error(
          `[RuntimeManager] 解析 ${configPath} 失败:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    log.info(`[RuntimeManager] 扫描完成，共发现 ${count} 个 Worker`)
    return count
  }

  /**
   * 获取已注册的 Worker 配置列表
   */
  getRegisteredWorkers(): WorkerConfig[] {
    return Array.from(this.configs.values())
  }

  // ==================== 启动/停止 ====================

  /**
   * 启动指定 Worker
   *
   * 流程：
   *   1. 获取/创建虚拟环境
   *   2. spawn 子进程
   *   3. 等待健康检查通过
   */
  async start(name: string): Promise<void> {
    const config = this.configs.get(name)
    if (!config) {
      throw new Error(`Worker "${name}" 未注册`)
    }

    const existing = this.workers.get(name)
    if (existing && (existing.status === 'ready' || existing.status === 'starting')) {
      log.info(`[RuntimeManager] Worker "${name}" 已在运行`)
      return
    }

    const worker: ManagedWorker = {
      config,
      process: null,
      status: 'stopped',
      restartCount: existing?.restartCount ?? 0,
      stopping: false
    }
    this.workers.set(name, worker)

    try {
      const isNative = config.type === 'native'

      if (isNative) {
        // Native Worker: 直接启动二进制，无需 venv
        this.updateStatus(worker, 'starting')
        await this.spawnNativeWorker(worker)
      } else {
        // Python Worker: 初始化虚拟环境 → 启动脚本
        this.updateStatus(worker, 'initializing')
        await this.ensureVenv(config)
        this.updateStatus(worker, 'starting')
        await this.spawnWorker(worker)
      }

      // 等待健康检查
      await this.waitForHealth(worker)
      this.updateStatus(worker, 'ready')

      log.info(`[RuntimeManager] Worker "${name}" 启动成功 (PID: ${worker.process?.pid})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      worker.error = msg
      this.updateStatus(worker, 'error')
      log.error(`[RuntimeManager] Worker "${name}" 启动失败: ${msg}`)
    }
  }

  /**
   * 停止指定 Worker
   *
   * 先 SIGTERM 优雅关闭，超时后 SIGKILL 强制关闭。
   */
  async stop(name: string): Promise<void> {
    const worker = this.workers.get(name)
    if (!worker || !worker.process) {
      return
    }

    worker.stopping = true
    this.updateStatus(worker, 'stopping')

    const proc = worker.process
    const pid = proc.pid

    return new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        // 超时强制杀
        if (proc.pid && !proc.killed) {
          log.warn(`[RuntimeManager] Worker "${name}" (PID: ${pid}) SIGTERM 超时，强制 SIGKILL`)
          proc.kill('SIGKILL')
        }
      }, 5000)

      proc.once('exit', () => {
        clearTimeout(killTimeout)
        worker.process = null
        worker.stopping = false
        this.updateStatus(worker, 'stopped')
        log.info(`[RuntimeManager] Worker "${name}" (PID: ${pid}) 已停止`)
        resolve()
      })

      // 先优雅关闭
      proc.kill('SIGTERM')
    })
  }

  /**
   * 停止所有 Worker（应用退出时调用）
   */
  async stopAll(): Promise<void> {
    this.shuttingDown = true
    log.info(`[RuntimeManager] 正在停止所有 Worker (${this.workers.size} 个)...`)

    const stopPromises = Array.from(this.workers.keys()).map((name) => this.stop(name))
    await Promise.allSettled(stopPromises)

    log.info('[RuntimeManager] 所有 Worker 已停止')
  }

  /**
   * 强制杀死所有子进程（process.exit 安全网）
   */
  forceKillAll(): void {
    for (const [name, worker] of this.workers) {
      if (worker.process && !worker.process.killed) {
        try {
          worker.process.kill('SIGKILL')
          log.warn(`[RuntimeManager] 强制杀死 Worker "${name}" (PID: ${worker.process.pid})`)
        } catch {
          // 忽略
        }
      }
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取所有 Worker 的当前信息（供 IPC 推送给 Renderer）
   */
  getAllWorkerInfo(): WorkerInfo[] {
    return Array.from(this.workers.values()).map((w) => this.toWorkerInfo(w))
  }

  /**
   * 获取指定 Worker 的信息
   */
  getWorkerInfo(name: string): WorkerInfo | undefined {
    const worker = this.workers.get(name)
    return worker ? this.toWorkerInfo(worker) : undefined
  }

  /**
   * 检查指定 Worker 是否就绪
   */
  isReady(name: string): boolean {
    return this.workers.get(name)?.status === 'ready'
  }

  // ==================== 虚拟环境管理 ====================

  /**
   * 确保 Worker 的虚拟环境存在且依赖已安装
   *
   * 使用 uv（已打包在 runtime/ 中）来管理 Python 环境。
   */
  private async ensureVenv(config: WorkerConfig): Promise<void> {
    const venvDir = this.getVenvDir(config.name)
    const pythonBin = this.getPythonBin(config.name)
    const uvBin = this.getUvBin()

    // 检查 uv 是否存在
    if (!fs.existsSync(uvBin)) {
      throw new Error(`uv 二进制不存在: ${uvBin}（请先运行 pnpm install 下载 uv）`)
    }

    // 检查 venv 是否存在
    if (!fs.existsSync(pythonBin)) {
      log.info(`[RuntimeManager] 创建虚拟环境: ${venvDir}`)
      await this.exec(uvBin, ['venv', venvDir, '--python', '3.11'], {
        cwd: this.getWorkerScriptsDir(config.name)
      })
    }

    // 安装/更新依赖
    const requirementsFile = config.requirementsFile || 'requirements.txt'
    const requirementsPath = path.join(this.getWorkerScriptsDir(config.name), requirementsFile)

    if (fs.existsSync(requirementsPath)) {
      log.info(`[RuntimeManager] 安装依赖: ${requirementsPath}`)
      await this.exec(uvBin, ['pip', 'install', '-r', requirementsPath, '--python', pythonBin], {
        cwd: this.getWorkerScriptsDir(config.name)
      })
    }
  }

  // ==================== 子进程管理 ====================

  /**
   * spawn Worker 子进程
   */
  private async spawnWorker(worker: ManagedWorker): Promise<void> {
    const { config } = worker
    const pythonBin = this.getPythonBin(config.name)
    const scriptsDir = this.getWorkerScriptsDir(config.name)
    const entryPath = path.join(scriptsDir, config.entry)

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Worker 入口文件不存在: ${entryPath}`)
    }

    const args = [entryPath, '--port', String(config.port), ...(config.args || [])]

    // 模型目录：统一由 .env VITE_MODEL_DIR 管理（Env.paths.modelsDir 已读取）
    const modelDir = Env.paths.modelsDir

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      // 模型目录
      MODEL_DIR: modelDir,
      MODELSCOPE_CACHE: modelDir,
      HF_HOME: modelDir,
      HUGGINGFACE_HUB_CACHE: path.join(modelDir, 'hub'),
      // Worker 自定义环境变量
      ...(config.env || {})
    }

    const child = spawn(pythonBin, args, {
      cwd: scriptsDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    worker.process = child

    // stdout → 日志
    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        log.info(`[Worker:${config.name}] ${msg}`)
        this.emit('worker:log', {
          type: 'worker:log',
          name: config.name,
          level: 'info',
          message: msg,
          timestamp: Date.now()
        })
      }
    })

    // stderr → 警告日志
    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        log.warn(`[Worker:${config.name}] ${msg}`)
        this.emit('worker:log', {
          type: 'worker:log',
          name: config.name,
          level: 'warn',
          message: msg,
          timestamp: Date.now()
        })
      }
    })

    // 进程退出处理
    child.on('exit', (code, signal) => {
      log.info(`[RuntimeManager] Worker "${config.name}" 退出 (code=${code}, signal=${signal})`)
      worker.process = null

      // 非主动停止 + 非全局关闭 → 可能需要自动重启
      if (!worker.stopping && !this.shuttingDown) {
        const maxRestarts = config.maxRestarts ?? 3
        const autoRestart = config.autoRestart !== false

        if (autoRestart && (maxRestarts === 0 || worker.restartCount < maxRestarts)) {
          worker.restartCount++
          const delay = Math.min(1000 * Math.pow(2, worker.restartCount - 1), 30000)
          log.info(
            `[RuntimeManager] Worker "${config.name}" 将在 ${delay}ms 后重启 (第 ${worker.restartCount} 次)`
          )
          worker.error = `进程异常退出 (code=${code})，${delay}ms 后重启...`
          this.updateStatus(worker, 'error')

          setTimeout(() => {
            if (!this.shuttingDown && !worker.stopping) {
              this.start(config.name).catch((err) => {
                log.error(`[RuntimeManager] Worker "${config.name}" 重启失败:`, err)
              })
            }
          }, delay)
        } else {
          worker.error = `进程异常退出 (code=${code})，已达重启上限`
          this.updateStatus(worker, 'error')
        }
      }
    })

    child.on('error', (err) => {
      log.error(`[RuntimeManager] Worker "${config.name}" 进程错误:`, err)
      worker.error = err.message
      worker.process = null
      this.updateStatus(worker, 'error')
    })
  }

  /**
   * spawn 原生二进制 Worker 子进程（无需 Python/venv）
   *
   * entry 从 runtime/{platform}/ 目录查找二进制文件，
   * args 从 worker.json 中获取，port 自动注入为 --port。
   */
  private async spawnNativeWorker(worker: ManagedWorker): Promise<void> {
    const { config } = worker
    const platformDir = Env.getPlatformRuntimeDir()
    const binaryName = config.entry
    const binaryPath = path.join(platformDir, binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Native Worker 二进制不存在: ${binaryPath}`)
    }

    const scriptsDir = this.getWorkerScriptsDir(config.name)
    const modelDir = config.modelDir || Env.paths.modelsDir

    // 构建启动参数，替换 ${MODEL_DIR} 等变量
    const rawArgs = [...(config.args || []), '--port', String(config.port)]
    const args = rawArgs.map((arg) => arg.replace(/\$\{MODEL_DIR\}/g, modelDir))

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      MODEL_DIR: modelDir,
      ...(config.env || {})
    }

    log.info(`[RuntimeManager] 启动 Native Worker: ${binaryPath} ${args.join(' ')}`)

    const child = spawn(binaryPath, args, {
      cwd: scriptsDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    worker.process = child

    // stdout → 日志
    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        log.info(`[Worker:${config.name}] ${msg}`)
        this.emit('worker:log', {
          type: 'worker:log',
          name: config.name,
          level: 'info',
          message: msg,
          timestamp: Date.now()
        })
      }
    })

    // stderr → 警告日志
    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        // whisper.cpp 输出日志到 stderr，不全是错误
        log.info(`[Worker:${config.name}] ${msg}`)
        this.emit('worker:log', {
          type: 'worker:log',
          name: config.name,
          level: 'info',
          message: msg,
          timestamp: Date.now()
        })
      }
    })

    // 进程退出处理（复用与 Python Worker 相同的重启逻辑）
    child.on('exit', (code, signal) => {
      log.info(`[RuntimeManager] Worker "${config.name}" 退出 (code=${code}, signal=${signal})`)
      worker.process = null

      if (!worker.stopping && !this.shuttingDown) {
        const maxRestarts = config.maxRestarts ?? 3
        const autoRestart = config.autoRestart !== false

        if (autoRestart && (maxRestarts === 0 || worker.restartCount < maxRestarts)) {
          worker.restartCount++
          const delay = Math.min(1000 * Math.pow(2, worker.restartCount - 1), 30000)
          log.info(
            `[RuntimeManager] Worker "${config.name}" 将在 ${delay}ms 后重启 (第 ${worker.restartCount} 次)`
          )
          worker.error = `进程异常退出 (code=${code})，${delay}ms 后重启...`
          this.updateStatus(worker, 'error')

          setTimeout(() => {
            if (!this.shuttingDown && !worker.stopping) {
              this.start(config.name).catch((err) => {
                log.error(`[RuntimeManager] Worker "${config.name}" 重启失败:`, err)
              })
            }
          }, delay)
        } else {
          worker.error = `进程异常退出 (code=${code})，已达重启上限`
          this.updateStatus(worker, 'error')
        }
      }
    })

    child.on('error', (err) => {
      log.error(`[RuntimeManager] Worker "${config.name}" 进程错误:`, err)
      worker.error = err.message
      worker.process = null
      this.updateStatus(worker, 'error')
    })
  }

  // ==================== 健康检查 ====================

  /**
   * 等待 Worker 健康检查通过
   */
  private async waitForHealth(worker: ManagedWorker): Promise<void> {
    const { config } = worker
    const healthPath = config.healthCheckPath || '/health'
    const timeout = config.healthCheckTimeout || 60000
    const url = `http://127.0.0.1:${config.port}${healthPath}`

    const startTime = Date.now()
    const pollInterval = 500

    while (Date.now() - startTime < timeout) {
      // 进程可能在等待期间退出
      if (!worker.process || worker.process.killed) {
        throw new Error('Worker 进程在健康检查期间退出')
      }

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000)
        })
        if (response.ok) {
          return // 健康检查通过
        }
      } catch {
        // 连接失败，继续轮询
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new Error(`健康检查超时 (${timeout}ms)：${url}`)
  }

  // ==================== 路径工具 ====================

  /** Worker 脚本目录（只读） */
  private getWorkerScriptsDir(name: string): string {
    return path.join(Env.paths.workersDir, name)
  }

  /** Worker 虚拟环境目录 */
  private getVenvDir(name: string): string {
    return path.join(Env.paths.workerEnvsDir, `${name}_env`)
  }

  /** Worker Python 可执行文件路径 */
  private getPythonBin(name: string): string {
    const venvDir = this.getVenvDir(name)
    return Env.isWindows
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python')
  }

  /** uv 可执行文件路径 */
  private getUvBin(): string {
    const platformDir = Env.getPlatformRuntimeDir()
    return Env.isWindows ? path.join(platformDir, 'uv.exe') : path.join(platformDir, 'uv')
  }

  // ==================== 内部工具 ====================

  /** 同步执行命令（用于 venv 初始化） */
  private exec(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      child.stdout?.on('data', (data: Buffer) => {
        log.info(`[uv] ${data.toString().trim()}`)
      })

      child.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`命令执行失败 (code=${code}): ${command} ${args.join(' ')}\n${stderr}`))
        }
      })
      child.on('error', reject)
    })
  }

  /** 更新 Worker 状态并发送事件 */
  private updateStatus(worker: ManagedWorker, status: WorkerStatus): void {
    worker.status = status
    const info = this.toWorkerInfo(worker)
    this.emit('worker:status', { type: 'worker:status', worker: info })
  }

  /** ManagedWorker → WorkerInfo（对外暴露的数据） */
  private toWorkerInfo(worker: ManagedWorker): WorkerInfo {
    return {
      name: worker.config.name,
      label: worker.config.label,
      status: worker.status,
      port: worker.status === 'ready' ? worker.config.port : undefined,
      error: worker.error,
      pid: worker.process?.pid,
      restartCount: worker.restartCount,
      updatedAt: Date.now()
    }
  }
}
