/**
 * Docker 沙箱管理测试
 *
 * 使用 mock 避免实际调用 Docker CLI，测试逻辑分支：
 *   - isDockerAvailable: 成功/失败/超时
 *   - getContainerState: 存在/不存在/运行中/已停止
 *   - ensureContainer: 创建新容器/启动已停止容器/已运行容器
 *   - execInContainer: 成功/失败/自定义 workdir
 *   - stopContainer / removeContainer: 正常和异常
 *   - listContainers: 空列表/多容器
 *   - removeAllContainers: 清理所有
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Mock child_process.spawn
vi.mock('node:child_process', async () => {
  const events = await import('node:events')
  const EventEmitter = events.EventEmitter

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createMockChild() {
    const child = new EventEmitter()
    ;(child as unknown as Record<string, unknown>).stdout = new EventEmitter()
    ;(child as unknown as Record<string, unknown>).stderr = new EventEmitter()
    ;(child as unknown as Record<string, unknown>).kill = vi.fn()
    return child
  }

  return {
    spawn: vi.fn(() => createMockChild())
  }
})

import { spawn } from 'node:child_process'
import {
  isDockerAvailable,
  getContainerState,
  ensureContainer,
  execInContainer,
  stopContainer,
  removeContainer,
  listContainers,
  removeAllContainers
} from '../docker'

/**
 * 辅助函数：模拟 spawn 返回特定 stdout/stderr/exitCode
 */
function mockSpawnResult(options: {
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: Error
}): void {
  const mockSpawn = spawn as unknown as Mock
  mockSpawn.mockImplementationOnce(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const EventEmitter = (require('node:events') as typeof import('node:events')).EventEmitter
    const child = new EventEmitter()
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    ;(child as unknown as Record<string, unknown>).stdout = stdout
    ;(child as unknown as Record<string, unknown>).stderr = stderr
    ;(child as unknown as Record<string, unknown>).kill = vi.fn()

    // 延迟触发事件
    process.nextTick(() => {
      if (options.error) {
        child.emit('error', options.error)
        return
      }
      if (options.stdout) {
        stdout.emit('data', Buffer.from(options.stdout))
      }
      if (options.stderr) {
        stderr.emit('data', Buffer.from(options.stderr))
      }
      child.emit('close', options.exitCode ?? 0, null)
    })

    return child
  })
}

/**
 * 批量设置 spawn mock（按调用顺序）
 */
function mockSpawnSequence(
  calls: Array<{ stdout?: string; stderr?: string; exitCode?: number; error?: Error }>
): void {
  for (const call of calls) {
    mockSpawnResult(call)
  }
}

describe('isDockerAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Docker 守护进程运行时返回 true', async () => {
    mockSpawnResult({ stdout: 'Docker info output...', exitCode: 0 })
    const result = await isDockerAvailable()
    expect(result).toBe(true)
  })

  it('Docker 守护进程未运行时返回 false', async () => {
    mockSpawnResult({ stderr: 'Cannot connect to Docker daemon', exitCode: 1 })
    const result = await isDockerAvailable()
    expect(result).toBe(false)
  })

  it('spawn 报错时返回 false', async () => {
    mockSpawnResult({ error: new Error('ENOENT: docker not found') })
    const result = await isDockerAvailable()
    expect(result).toBe(false)
  })

  it('调用 docker info 命令', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    await isDockerAvailable()
    const mockSpawnFn = spawn as unknown as Mock
    expect(mockSpawnFn).toHaveBeenCalledWith(
      'docker',
      ['info'],
      expect.objectContaining({ timeout: 5000 })
    )
  })
})

describe('getContainerState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('容器运行中', async () => {
    mockSpawnResult({ stdout: 'true\n', exitCode: 0 })
    const state = await getContainerState('my-container')
    expect(state).toEqual({ exists: true, running: true })
  })

  it('容器已停止', async () => {
    mockSpawnResult({ stdout: 'false\n', exitCode: 0 })
    const state = await getContainerState('my-container')
    expect(state).toEqual({ exists: true, running: false })
  })

  it('容器不存在', async () => {
    mockSpawnResult({ stderr: 'No such container', exitCode: 1 })
    const state = await getContainerState('nonexistent')
    expect(state).toEqual({ exists: false, running: false })
  })

  it('调用 docker inspect 命令', async () => {
    mockSpawnResult({ stdout: 'true', exitCode: 0 })
    await getContainerState('test-ctr')
    const mockSpawnFn = spawn as unknown as Mock
    expect(mockSpawnFn).toHaveBeenCalledWith(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', 'test-ctr'],
      expect.anything()
    )
  })
})

describe('ensureContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('容器不存在时创建并启动', async () => {
    mockSpawnSequence([
      // getContainerState → 不存在
      { stderr: 'No such container', exitCode: 1 },
      // docker create
      { stdout: 'container-id\n', exitCode: 0 },
      // docker start
      { stdout: '', exitCode: 0 }
    ])

    const info = await ensureContainer({
      sessionId: 'test-session-123',
      workspaceDir: '/home/user/project'
    })

    expect(info.containerName).toContain('coobee-sbx-')
    expect(info.containerName).toContain('test-session-123')
    expect(info.workdir).toBe('/workspace')
    expect(info.running).toBe(true)
  })

  it('容器已存在但未运行时只启动', async () => {
    mockSpawnSequence([
      // getContainerState → 存在但未运行
      { stdout: 'false\n', exitCode: 0 },
      // docker start
      { stdout: '', exitCode: 0 }
    ])

    const info = await ensureContainer({
      sessionId: 'stopped-session',
      workspaceDir: '/home/user/project'
    })

    expect(info.running).toBe(true)
    // 应该只调用了 inspect 和 start，没有 create
    const mockSpawnFn = spawn as unknown as Mock
    expect(mockSpawnFn).toHaveBeenCalledTimes(2)
  })

  it('容器已运行时直接返回', async () => {
    mockSpawnSequence([
      // getContainerState → 运行中
      { stdout: 'true\n', exitCode: 0 }
    ])

    const info = await ensureContainer({
      sessionId: 'running-session',
      workspaceDir: '/home/user/project'
    })

    expect(info.running).toBe(true)
    const mockSpawnFn = spawn as unknown as Mock
    expect(mockSpawnFn).toHaveBeenCalledTimes(1) // 只调用了 inspect
  })

  it('sessionId 中特殊字符被清理', async () => {
    mockSpawnSequence([
      { stdout: 'true\n', exitCode: 0 } // 已运行
    ])

    const info = await ensureContainer({
      sessionId: 'SESSION_WITH_SPECIAL!@#$%chars',
      workspaceDir: '/home/user/project'
    })

    // 容器名应该只包含合法字符
    expect(info.containerName).toMatch(/^coobee-sbx-[a-z0-9.-]+$/)
  })

  it('使用自定义 Docker 配置', async () => {
    mockSpawnSequence([
      { stderr: 'No such container', exitCode: 1 }, // 不存在
      { stdout: 'id\n', exitCode: 0 }, // create
      { stdout: '', exitCode: 0 } // start
    ])

    await ensureContainer({
      sessionId: 'custom-cfg',
      workspaceDir: '/my/workspace',
      config: {
        image: 'ubuntu:22.04',
        workdir: '/app',
        memory: '512m',
        cpus: 2
      }
    })

    const mockSpawnFn = spawn as unknown as Mock
    // 检查 docker create 的参数
    const createCall = mockSpawnFn.mock.calls[1]
    const createArgs = createCall[1] as string[]
    expect(createArgs).toContain('ubuntu:22.04')
    expect(createArgs).toContain('--workdir')
    expect(createArgs).toContain('/app')
    expect(createArgs).toContain('--memory')
    expect(createArgs).toContain('512m')
    expect(createArgs).toContain('--cpus')
    expect(createArgs).toContain('2')
  })

  it('带 setupCommand 的容器创建', async () => {
    mockSpawnSequence([
      { stderr: 'No such container', exitCode: 1 }, // 不存在
      { stdout: 'id\n', exitCode: 0 }, // create
      { stdout: '', exitCode: 0 }, // start
      { stdout: 'setup done\n', exitCode: 0 } // setupCommand
    ])

    await ensureContainer({
      sessionId: 'setup-test',
      workspaceDir: '/workspace',
      config: { setupCommand: 'apt-get update' }
    })

    const mockSpawnFn = spawn as unknown as Mock
    // 第 4 次调用应该是 exec setup command
    expect(mockSpawnFn).toHaveBeenCalledTimes(4)
    const execCall = mockSpawnFn.mock.calls[3]
    const execArgs = execCall[1] as string[]
    expect(execArgs).toContain('exec')
    expect(execArgs).toContain('apt-get update')
  })
})

describe('execInContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('执行命令返回输出', async () => {
    mockSpawnResult({ stdout: 'hello world\n', exitCode: 0 })
    const result = await execInContainer('my-ctr', 'echo hello world')
    expect(result.stdout).toContain('hello world')
    expect(result.exitCode).toBe(0)
  })

  it('命令失败返回非零退出码', async () => {
    mockSpawnResult({ stderr: 'command not found', exitCode: 127 })
    const result = await execInContainer('my-ctr', 'invalid_command')
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toContain('command not found')
  })

  it('自定义工作目录', async () => {
    mockSpawnResult({ stdout: '/app/src\n', exitCode: 0 })
    await execInContainer('my-ctr', 'pwd', { workdir: '/app/src' })

    const mockSpawnFn = spawn as unknown as Mock
    const args = mockSpawnFn.mock.calls[0][1] as string[]
    expect(args).toContain('-w')
    expect(args).toContain('/app/src')
  })

  it('包含正确的 docker exec 参数', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    await execInContainer('test-ctr', 'ls -la')

    const mockSpawnFn = spawn as unknown as Mock
    const args = mockSpawnFn.mock.calls[0][1] as string[]
    expect(args[0]).toBe('exec')
    expect(args).toContain('-i')
    expect(args).toContain('test-ctr')
    expect(args).toContain('sh')
    expect(args).toContain('-c')
    expect(args).toContain('ls -la')
  })
})

describe('stopContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('停止容器', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    await expect(stopContainer('my-ctr')).resolves.toBeUndefined()

    const mockSpawnFn = spawn as unknown as Mock
    const args = mockSpawnFn.mock.calls[0][1] as string[]
    expect(args).toContain('stop')
    expect(args).toContain('-t')
    expect(args).toContain('5')
    expect(args).toContain('my-ctr')
  })

  it('容器不存在时不抛错（allowFailure）', async () => {
    mockSpawnResult({ stderr: 'No such container', exitCode: 1 })
    await expect(stopContainer('nonexistent')).resolves.toBeUndefined()
  })
})

describe('removeContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('强制删除容器', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    await expect(removeContainer('my-ctr')).resolves.toBeUndefined()

    const mockSpawnFn = spawn as unknown as Mock
    const args = mockSpawnFn.mock.calls[0][1] as string[]
    expect(args).toContain('rm')
    expect(args).toContain('-f')
    expect(args).toContain('my-ctr')
  })

  it('容器不存在时不抛错', async () => {
    mockSpawnResult({ stderr: 'No such container', exitCode: 1 })
    await expect(removeContainer('nonexistent')).resolves.toBeUndefined()
  })
})

describe('listContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('列出多个容器', async () => {
    mockSpawnResult({
      stdout:
        'coobee-sbx-a\trunning\tsession-a\t2024-01-01T00:00:00Z\ncoobee-sbx-b\texited\tsession-b\t2024-01-02T00:00:00Z\n',
      exitCode: 0
    })

    const containers = await listContainers()
    expect(containers).toHaveLength(2)
    expect(containers[0]).toEqual({
      name: 'coobee-sbx-a',
      running: true,
      sessionId: 'session-a',
      createdAt: '2024-01-01T00:00:00Z'
    })
    expect(containers[1]).toEqual({
      name: 'coobee-sbx-b',
      running: false,
      sessionId: 'session-b',
      createdAt: '2024-01-02T00:00:00Z'
    })
  })

  it('无容器时返回空数组', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    const containers = await listContainers()
    expect(containers).toEqual([])
  })

  it('docker 命令失败时返回空数组', async () => {
    mockSpawnResult({ stderr: 'Docker not running', exitCode: 1 })
    const containers = await listContainers()
    expect(containers).toEqual([])
  })

  it('使用正确的过滤标签', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    await listContainers()

    const mockSpawnFn = spawn as unknown as Mock
    const args = mockSpawnFn.mock.calls[0][1] as string[]
    expect(args).toContain('--filter')
    expect(args).toContain('label=coobee.sandbox=1')
  })
})

describe('removeAllContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('清理所有容器并返回数量', async () => {
    mockSpawnSequence([
      // listContainers
      { stdout: 'ctr-a\trunning\ts-a\t2024-01-01\nctr-b\texited\ts-b\t2024-01-02\n', exitCode: 0 },
      // removeContainer ctr-a
      { stdout: '', exitCode: 0 },
      // removeContainer ctr-b
      { stdout: '', exitCode: 0 }
    ])

    const count = await removeAllContainers()
    expect(count).toBe(2)
  })

  it('无容器时返回 0', async () => {
    mockSpawnResult({ stdout: '', exitCode: 0 })
    const count = await removeAllContainers()
    expect(count).toBe(0)
  })
})
