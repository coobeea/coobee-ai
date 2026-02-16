/**
 * process 工具单元测试
 *
 * 测试 process 工具（管理 exec background 启动的后台进程）：
 *   - list, read_output, send_input, send_signal, kill
 *   - 参数校验、错误处理
 *
 * 使用真实进程测试，依赖 ProcessRegistry 和 exec 工具。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'
import { processTool } from '../builtin/process'
import { execTool } from '../builtin/exec'
import { ProcessRegistry } from '../../process/ProcessRegistry'

vi.mock('@main/common/logger', () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
  return { log, createLogger: vi.fn(() => log) }
})

// Mock extension system（exec 工具检查 tool-approval 是否加载）
vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getRegistry: (): { getExtensionIds: () => string[] } => ({
      getExtensionIds: (): string[] => ['tool-approval']
    }),
    getHookRunner: (): null => null
  }
}))

/**
 * 消费 AsyncGenerator，收集 yield 的更新和最终结果
 */
async function consumeGenerator(
  gen: AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>
): Promise<{ updates: ToolStreamUpdate[]; result: ToolResult }> {
  const updates: ToolStreamUpdate[] = []
  let next = await gen.next()
  while (!next.done) {
    updates.push(next.value)
    next = await gen.next()
  }
  return { updates, result: next.value }
}

describe('processTool', () => {
  afterEach(() => {
    ProcessRegistry.resetInstance()
  })

  // ==================== action=list ====================

  describe('action=list', () => {
    it('空列表时返回 No background processes', async () => {
      const { result } = await consumeGenerator(processTool.execute({ action: 'list' }))

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('No background processes')
    })

    it('有进程时列出所有后台进程', async () => {
      // 启动一个后台进程
      await consumeGenerator(execTool.execute({ command: 'sleep 5', background: true }))

      const { result } = await consumeGenerator(processTool.execute({ action: 'list' }))

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Background processes')
      expect(result.llmContent).toContain('proc-1')
      expect(result.llmContent).toContain('sleep 5')
      expect(result.llmContent).toMatch(/running|🟢/)
    })
  })

  // ==================== action=read_output ====================

  describe('action=read_output', () => {
    it('正常读取进程输出', async () => {
      // 启动产生输出的后台进程（打印后等待）
      await consumeGenerator(
        execTool.execute({
          command:
            "node -e \"console.log('line1'); console.log('line2'); setInterval(()=>{}, 9999)\"",
          background: true
        })
      )

      // 等待输出被收集
      await new Promise((r) => setTimeout(r, 100))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'read_output',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('line1')
      expect(result.llmContent).toContain('line2')
      expect(result.llmContent).toContain('proc-1')
    })

    it('无输出时返回 no output yet', async () => {
      // sleep 不产生输出
      await consumeGenerator(execTool.execute({ command: 'sleep 5', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'read_output',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('no output yet')
    })

    it('进程不存在时返回错误', async () => {
      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'read_output',
          processId: 'proc-nonexistent'
        })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
      expect(result.llmContent).toContain('not found')
    })

    it('支持 lastN 参数限制返回行数', async () => {
      await consumeGenerator(
        execTool.execute({
          command:
            'node -e "for(let i=1;i<=10;i++) console.log(\'line\'+i); setInterval(()=>{}, 9999)"',
          background: true
        })
      )

      await new Promise((r) => setTimeout(r, 100))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'read_output',
          processId: 'proc-1',
          lastN: 3
        })
      )

      expect(result.success).toBe(true)
      // 应返回最近 3 行
      expect(result.llmContent).toContain('line8')
      expect(result.llmContent).toContain('line9')
      expect(result.llmContent).toContain('line10')
    })
  })

  // ==================== action=send_input ====================

  describe('action=send_input', () => {
    it('成功向进程发送输入', async () => {
      // cat 会读取 stdin 并回显
      await consumeGenerator(execTool.execute({ command: 'cat', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_input',
          processId: 'proc-1',
          input: 'hello from test'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Sent input')
      expect(result.llmContent).toContain('hello from test')
    })

    it('进程已结束时返回错误', async () => {
      // 启动后立即结束的进程
      await consumeGenerator(execTool.execute({ command: 'true', background: true }))

      await new Promise((r) => setTimeout(r, 50))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_input',
          processId: 'proc-1',
          input: 'test'
        })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_RUNNING')
      expect(result.llmContent).toContain('not running')
    })

    it('缺少 input 时返回错误', async () => {
      await consumeGenerator(execTool.execute({ command: 'sleep 5', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_input',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_PARAM')
      expect(result.llmContent).toContain('input is required')
    })
  })

  // ==================== action=send_signal ====================

  describe('action=send_signal', () => {
    it('成功向进程发送信号', async () => {
      await consumeGenerator(execTool.execute({ command: 'sleep 10', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_signal',
          processId: 'proc-1',
          signal: 'SIGINT'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Signal SIGINT sent')
    })

    it('进程已结束时返回错误', async () => {
      await consumeGenerator(execTool.execute({ command: 'true', background: true }))

      await new Promise((r) => setTimeout(r, 50))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_signal',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_RUNNING')
    })

    it('默认使用 SIGINT', async () => {
      await consumeGenerator(execTool.execute({ command: 'sleep 10', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'send_signal',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('SIGINT')
    })
  })

  // ==================== action=kill ====================

  describe('action=kill', () => {
    it('终止运行中的进程', async () => {
      await consumeGenerator(execTool.execute({ command: 'sleep 10', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'kill',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('terminated')
      expect(result.llmContent).toContain('SIGTERM')
    })

    it('已结束的进程返回友好提示', async () => {
      await consumeGenerator(execTool.execute({ command: 'true', background: true }))

      await new Promise((r) => setTimeout(r, 50))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'kill',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('already')
      expect(result.llmContent).toMatch(/exited|killed/)
    })
  })

  // ==================== 参数校验 ====================

  describe('参数校验', () => {
    it('缺少 processId 时返回错误（read_output）', async () => {
      const { result } = await consumeGenerator(processTool.execute({ action: 'read_output' }))

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_PARAM')
      expect(result.llmContent).toContain('processId is required')
    })

    it('缺少 processId 时返回错误（send_input）', async () => {
      const { result } = await consumeGenerator(
        processTool.execute({ action: 'send_input', input: 'test' })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_PARAM')
    })

    it('缺少 processId 时返回错误（kill）', async () => {
      const { result } = await consumeGenerator(processTool.execute({ action: 'kill' }))

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_PARAM')
    })

    it('未知 action 返回错误', async () => {
      // 需要先有进程存在，否则会先返回 NOT_FOUND
      await consumeGenerator(execTool.execute({ command: 'sleep 5', background: true }))

      const { result } = await consumeGenerator(
        processTool.execute({
          action: 'invalid_action',
          processId: 'proc-1'
        })
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('UNKNOWN_ACTION')
      expect(result.llmContent).toContain('Unknown action')
      expect(result.llmContent).toContain('invalid_action')
    })
  })

  // ==================== 元数据 ====================

  describe('元数据', () => {
    it('工具名称为 process，分类为 Execute', () => {
      expect(processTool.name).toBe('process')
      expect(processTool.category).toBe(ToolCategory.Execute)
    })

    it('needUserConfirm 为 false', () => {
      expect(processTool.needUserConfirm).toBe(false)
    })
  })
})
