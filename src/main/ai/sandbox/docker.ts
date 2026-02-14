/**
 * Docker 沙箱管理（精简版）
 *
 * 提供 Docker 容器的创建、启动、停止、执行和清理。
 * 参考 OpenClaw 的 docker.ts，但大幅简化：
 *   - 无容器注册表（用内存 Map 追踪）
 *   - 无自动清理/剪枝（手动 stop/remove）
 *   - 无浏览器沙箱
 *   - 无配置哈希检测
 *
 * 核心流程：
 *   1. isDockerAvailable() — 检查 Docker CLI
 *   2. ensureContainer()   — 创建或启动容器
 *   3. execInContainer()   — 在容器中执行命令
 *   4. stopContainer()     — 停止容器
 *   5. removeContainer()   — 删除容器
 */
import { spawn } from 'node:child_process'
import type { SandboxDockerConfig, SandboxDockerInfo } from './types'
import { DEFAULT_DOCKER_CONFIG } from './types'

// ========== Docker CLI 执行 ==========

/** Docker 命令执行结果 */
interface DockerExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * 执行 docker CLI 命令
 */
function execDocker(
  args: string[],
  options?: { allowFailure?: boolean; timeout?: number }
): Promise<DockerExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options?.timeout ?? 30_000
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err: Error) => {
      if (options?.allowFailure) {
        resolve({ stdout, stderr: err.message, exitCode: 1 })
      } else {
        reject(err)
      }
    })
    child.on('close', (code: number | null) => {
      const exitCode = code ?? 0
      if (exitCode !== 0 && !options?.allowFailure) {
        reject(new Error(stderr.trim() || `docker ${args.join(' ')} failed (exit ${exitCode})`))
      } else {
        resolve({ stdout, stderr, exitCode })
      }
    })
  })
}

// ========== 公开 API ==========

/**
 * 检查 Docker 是否可用
 *
 * 尝试执行 `docker info`，如果成功则 Docker daemon 正在运行。
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await execDocker(['info'], { allowFailure: true, timeout: 5_000 })
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * 检查容器状态
 */
export async function getContainerState(
  containerName: string
): Promise<{ exists: boolean; running: boolean }> {
  const result = await execDocker(['inspect', '-f', '{{.State.Running}}', containerName], {
    allowFailure: true
  })
  if (result.exitCode !== 0) {
    return { exists: false, running: false }
  }
  return { exists: true, running: result.stdout.trim() === 'true' }
}

/**
 * 构建 docker create 参数
 *
 * 参考 OpenClaw 的 buildSandboxCreateArgs，精简为必要参数。
 */
function buildCreateArgs(params: {
  containerName: string
  cfg: SandboxDockerConfig
  workspaceDir: string
  labels?: Record<string, string>
}): string[] {
  const { containerName, cfg, workspaceDir } = params
  const args = ['create', '--name', containerName]

  // 标签
  args.push('--label', 'coobee.sandbox=1')
  args.push('--label', `coobee.createdAt=${new Date().toISOString()}`)
  for (const [key, value] of Object.entries(params.labels ?? {})) {
    if (key && value) args.push('--label', `${key}=${value}`)
  }

  // 安全
  if (cfg.readOnlyRoot) args.push('--read-only')
  for (const entry of cfg.tmpfs) args.push('--tmpfs', entry)
  if (cfg.network) args.push('--network', cfg.network)
  for (const cap of cfg.capDrop) args.push('--cap-drop', cap)
  args.push('--security-opt', 'no-new-privileges')

  // 资源限制
  if (cfg.memory) args.push('--memory', cfg.memory)
  if (typeof cfg.cpus === 'number' && cfg.cpus > 0) args.push('--cpus', String(cfg.cpus))

  // 环境变量
  for (const [key, value] of Object.entries(cfg.env ?? {})) {
    args.push('-e', `${key}=${value}`)
  }

  // 工作目录
  args.push('--workdir', cfg.workdir)

  // 挂载工作区
  args.push('-v', `${workspaceDir}:${cfg.workdir}`)

  // 镜像 + 保持运行
  args.push(cfg.image, 'sleep', 'infinity')

  return args
}

/**
 * 确保沙箱容器存在并运行
 *
 * - 容器不存在 → 创建并启动
 * - 容器存在但未运行 → 启动
 * - 容器已运行 → 直接返回
 *
 * @param params - 容器参数
 * @returns 容器运行时信息
 */
export async function ensureContainer(params: {
  sessionId: string
  workspaceDir: string
  config?: Partial<SandboxDockerConfig>
}): Promise<SandboxDockerInfo> {
  const cfg: SandboxDockerConfig = { ...DEFAULT_DOCKER_CONFIG, ...params.config }
  // 生成容器名：prefix + sessionId 的前 12 位
  const slug = params.sessionId
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .slice(0, 32)
  const containerName = `${cfg.containerPrefix}${slug}`

  const state = await getContainerState(containerName)

  if (!state.exists) {
    // 创建容器
    const args = buildCreateArgs({
      containerName,
      cfg,
      workspaceDir: params.workspaceDir,
      labels: { 'coobee.sessionId': params.sessionId }
    })
    await execDocker(args)

    // 启动
    await execDocker(['start', containerName])

    // 执行初始化命令
    if (cfg.setupCommand?.trim()) {
      await execDocker(['exec', '-i', containerName, 'sh', '-lc', cfg.setupCommand], {
        allowFailure: true,
        timeout: 60_000
      })
    }
  } else if (!state.running) {
    await execDocker(['start', containerName])
  }

  return {
    containerName,
    workdir: cfg.workdir,
    running: true
  }
}

/**
 * 在容器中执行命令
 *
 * @param containerName - 容器名
 * @param command       - 要执行的 shell 命令
 * @param options       - 执行选项
 * @returns 执行结果
 */
export async function execInContainer(
  containerName: string,
  command: string,
  options?: { timeout?: number; workdir?: string }
): Promise<DockerExecResult> {
  const args = ['exec', '-i']
  if (options?.workdir) {
    args.push('-w', options.workdir)
  }
  args.push(containerName, 'sh', '-c', command)

  return execDocker(args, {
    allowFailure: true,
    timeout: options?.timeout ?? 30_000
  })
}

/**
 * 停止容器
 */
export async function stopContainer(containerName: string): Promise<void> {
  await execDocker(['stop', '-t', '5', containerName], { allowFailure: true })
}

/**
 * 删除容器（强制）
 */
export async function removeContainer(containerName: string): Promise<void> {
  await execDocker(['rm', '-f', containerName], { allowFailure: true })
}

/**
 * 列出所有 coobee 沙箱容器
 */
export async function listContainers(): Promise<
  Array<{ name: string; running: boolean; sessionId: string; createdAt: string }>
> {
  const result = await execDocker(
    [
      'ps',
      '-a',
      '--filter',
      'label=coobee.sandbox=1',
      '--format',
      '{{.Names}}\t{{.State}}\t{{.Label "coobee.sessionId"}}\t{{.Label "coobee.createdAt"}}'
    ],
    { allowFailure: true }
  )

  if (result.exitCode !== 0 || !result.stdout.trim()) return []

  return result.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [name, state, sessionId, createdAt] = line.split('\t')
      return {
        name: name || '',
        running: state === 'running',
        sessionId: sessionId || '',
        createdAt: createdAt || ''
      }
    })
}

/**
 * 清理所有 coobee 沙箱容器
 */
export async function removeAllContainers(): Promise<number> {
  const containers = await listContainers()
  for (const c of containers) {
    await removeContainer(c.name)
  }
  return containers.length
}
