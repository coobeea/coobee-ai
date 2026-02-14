/**
 * ProcessRegistry 单元测试
 *
 * 覆盖维度：
 *   - 单例模式
 *   - register / list / get / readOutput / sendInput / sendSignal / kill
 *   - cleanup / prune
 *   - 输出缓冲（MAX_OUTPUT_LINES 裁剪）
 *
 * 使用真实进程：echo、sleep、cat、node
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawn } from 'node:child_process'

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { ProcessRegistry } from '../builtin/ProcessRegistry'

function spawnAndRegister(
  registry: ProcessRegistry,
  command: string,
  cwd: string = process.cwd()
): { processId: string; child: ReturnType<typeof spawn> } {
  const child = spawn(command, {
    shell: true,
    cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const processId = registry.register(command, cwd, child)
  return { processId, child }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('ProcessRegistry', () => {
  afterEach(() => {
    ProcessRegistry.resetInstance()
  })

  // ═══════════════════════════════════════════
  // 1. 单例模式
  // ═══════════════════════════════════════════

  describe('单例模式', () => {
    it('getInstance() 返回同一实例', () => {
      const a = ProcessRegistry.getInstance()
      const b = ProcessRegistry.getInstance()
      expect(a).toBe(b)
    })

    it('resetInstance() 清理并重置', () => {
      const a = ProcessRegistry.getInstance()
      ProcessRegistry.resetInstance()
      const b = ProcessRegistry.getInstance()
      expect(a).not.toBe(b)
    })
  })

  // ═══════════════════════════════════════════
  // 2. register()
  // ═══════════════════════════════════════════

  describe('register()', () => {
    it('注册后 size 增加', () => {
      const registry = ProcessRegistry.getInstance()
      expect(registry.size).toBe(0)
      const { processId } = spawnAndRegister(registry, 'echo hello')
      expect(registry.size).toBe(1)
      expect(processId).toBeDefined()
    })

    it('返回唯一 processId（proc-1, proc-2...）', () => {
      const registry = ProcessRegistry.getInstance()
      const { processId: id1 } = spawnAndRegister(registry, 'echo a')
      const { processId: id2 } = spawnAndRegister(registry, 'echo b')
      expect(id1).toBe('proc-1')
      expect(id2).toBe('proc-2')
    })

    it('自动收集 stdout 到 outputBuffer', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo hello')
      await wait(50)
      const output = registry.readOutput(processId)
      expect(output).toContain('hello')
    })

    it('自动收集 stderr 到 outputBuffer', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo err >&2')
      await wait(50)
      const output = registry.readOutput(processId)
      expect(output).toContain('err')
    })

    it('进程退出时 status 更新为 exited', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo done')
      await wait(100)
      const proc = registry.get(processId)
      expect(proc?.status).toBe('exited')
    })

    it('进程被杀时 status 更新为 killed', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'sleep 100')
      registry.sendSignal(processId, 'SIGINT')
      await wait(150)
      const proc = registry.get(processId)
      expect(proc?.status).toBe('killed')
    })

    it('进程出错时 status 更新为 error', async () => {
      const registry = ProcessRegistry.getInstance()
      // 使用真实 spawn 后手动触发 error 事件（spawn 失败时行为因平台而异）
      const child = spawn('echo ok', {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const processId = registry.register('mock-error', process.cwd(), child)
      child.emit('error', new Error('spawn ENOENT'))
      await wait(50)
      const proc = registry.get(processId)
      expect(proc?.status).toBe('error')
    })
  })

  // ═══════════════════════════════════════════
  // 3. list()
  // ═══════════════════════════════════════════

  describe('list()', () => {
    it('空注册表返回空数组', () => {
      const registry = ProcessRegistry.getInstance()
      expect(registry.list()).toEqual([])
    })

    it('返回所有进程（含 running 和 exited）', async () => {
      const registry = ProcessRegistry.getInstance()
      spawnAndRegister(registry, 'echo a')
      const { processId: runningId } = spawnAndRegister(registry, 'sleep 5')
      await wait(80)
      const list = registry.list()
      expect(list.length).toBe(2)
      const exited = list.find((p) => p.status === 'exited')
      const running = list.find((p) => p.processId === runningId)
      expect(exited).toBeDefined()
      expect(running?.status).toBe('running')
      registry.kill(runningId)
    })

    it('返回正确的 runningMs', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo x')
      await wait(50)
      const list = registry.list()
      const proc = list.find((p) => p.processId === processId)
      expect(proc).toBeDefined()
      expect(proc!.runningMs).toBeGreaterThanOrEqual(0)
      expect(typeof proc!.runningMs).toBe('number')
    })
  })

  // ═══════════════════════════════════════════
  // 4. get()
  // ═══════════════════════════════════════════

  describe('get()', () => {
    it('获取已注册进程', () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo test')
      const proc = registry.get(processId)
      expect(proc).toBeDefined()
      expect(proc!.processId).toBe(processId)
      expect(proc!.command).toBe('echo test')
      expect(proc!.status).toBe('running')
    })

    it('获取不存在的进程返回 undefined', () => {
      const registry = ProcessRegistry.getInstance()
      expect(registry.get('proc-999')).toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════
  // 5. readOutput()
  // ═══════════════════════════════════════════

  describe('readOutput()', () => {
    it('读取完整输出', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo line1 && echo line2')
      await wait(80)
      const output = registry.readOutput(processId)
      expect(output).toContain('line1')
      expect(output).toContain('line2')
    })

    it('lastN 参数限制行数', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(
        registry,
        'echo a && echo b && echo c && echo d && echo e'
      )
      await wait(80)
      const full = registry.readOutput(processId)
      const last2 = registry.readOutput(processId, 2)
      expect(full).toBeDefined()
      expect(last2).toBeDefined()
      const last2Lines = last2!.trim().split('\n').filter(Boolean)
      expect(last2Lines.length).toBeLessThanOrEqual(2)
    })

    it('不存在的进程返回 undefined', () => {
      const registry = ProcessRegistry.getInstance()
      expect(registry.readOutput('proc-999')).toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════
  // 6. sendInput()
  // ═══════════════════════════════════════════

  describe('sendInput()', () => {
    it('向运行中进程发送输入成功', () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'cat')
      const result = registry.sendInput(processId, 'hello')
      expect(result).toBe(true)
      registry.kill(processId)
    })

    it('向已结束进程返回 false', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo done')
      await wait(100)
      const result = registry.sendInput(processId, 'x')
      expect(result).toBe(false)
    })

    it('不存在的进程返回 false', () => {
      const registry = ProcessRegistry.getInstance()
      expect(registry.sendInput('proc-999', 'x')).toBe(false)
    })
  })

  // ═══════════════════════════════════════════
  // 7. sendSignal()
  // ═══════════════════════════════════════════

  describe('sendSignal()', () => {
    it('发送 SIGINT 成功', () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'sleep 10')
      const result = registry.sendSignal(processId, 'SIGINT')
      expect(result).toBe(true)
      // 进程会被 kill，afterEach 会 resetInstance 做 cleanup
    })

    it('向已结束进程返回 false', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo x')
      await wait(100)
      const result = registry.sendSignal(processId, 'SIGINT')
      expect(result).toBe(false)
    })
  })

  // ═══════════════════════════════════════════
  // 8. kill()
  // ═══════════════════════════════════════════

  describe('kill()', () => {
    it('终止运行中进程', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'sleep 100')
      const result = registry.kill(processId)
      expect(result).toBe(true)
      await wait(150)
      const proc = registry.get(processId)
      expect(proc?.status).toBe('killed')
    })

    it('已结束进程返回 false', async () => {
      const registry = ProcessRegistry.getInstance()
      const { processId } = spawnAndRegister(registry, 'echo x')
      await wait(100)
      const result = registry.kill(processId)
      expect(result).toBe(false)
    })
  })

  // ═══════════════════════════════════════════
  // 9. cleanup()
  // ═══════════════════════════════════════════

  describe('cleanup()', () => {
    it('杀死所有运行中进程并清空 Map', async () => {
      const registry = ProcessRegistry.getInstance()
      spawnAndRegister(registry, 'sleep 100')
      spawnAndRegister(registry, 'sleep 100')
      expect(registry.size).toBe(2)
      expect(registry.runningCount).toBe(2)
      registry.cleanup()
      expect(registry.size).toBe(0)
      await wait(100)
    })
  })

  // ═══════════════════════════════════════════
  // 10. prune()
  // ═══════════════════════════════════════════

  describe('prune()', () => {
    it('移除已结束进程，保留运行中进程', async () => {
      const registry = ProcessRegistry.getInstance()
      spawnAndRegister(registry, 'echo a')
      const { processId: runningId } = spawnAndRegister(registry, 'sleep 5')
      await wait(80)
      expect(registry.size).toBe(2)
      const pruned = registry.prune()
      expect(pruned).toBeGreaterThanOrEqual(1)
      expect(registry.size).toBeLessThanOrEqual(1)
      const list = registry.list()
      const running = list.find((p) => p.processId === runningId)
      expect(running?.status).toBe('running')
      registry.kill(runningId)
    })
  })

  // ═══════════════════════════════════════════
  // 11. 输出缓冲
  // ═══════════════════════════════════════════

  describe('输出缓冲', () => {
    it('超过 MAX_OUTPUT_LINES 时裁剪', async () => {
      const registry = ProcessRegistry.getInstance()
      // 输出 1100 行，超过 MAX_OUTPUT_LINES(1000)
      const { processId } = spawnAndRegister(
        registry,
        'node -e "for(let i=0;i<1100;i++) console.log(\'line\'+i)"'
      )
      await wait(500)
      const output = registry.readOutput(processId)
      expect(output).toBeDefined()
      const lines = output!.trim().split('\n').filter(Boolean)
      // 裁剪后应保留最近 1000 行
      expect(lines.length).toBeLessThanOrEqual(1000)
      expect(lines.length).toBeGreaterThan(500)
    }, 5000)
  })
})
