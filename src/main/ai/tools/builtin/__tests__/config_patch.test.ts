/**
 * config_patch 工具测试
 *
 * 覆盖：
 *   - 正常 patch 应用
 *   - JSON5 解析错误处理
 *   - 非对象 patch 拒绝
 *   - ConfigStore 不可用的降级
 *   - Schema 校验失败的处理
 *   - 深度合并验证
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'

// ===== Mock Electron =====
vi.mock('electron', () => {
  const base = join(process.cwd(), 'test-results')
  return {
    app: {
      getPath: (name: string) => join(base, name),
      getAppPath: () => base,
      getName: () => 'coobee-test',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

vi.mock('electron-log', () => {
  const noop = (): void => {}
  const mockTransport = {
    resolvePathFn: null,
    level: 'info',
    maxSize: 10 * 1024 * 1024,
    format: '',
    getFile: () => ({ path: '/tmp/test.log' })
  }
  const mockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    transports: {
      file: { ...mockTransport },
      console: { level: 'info', format: '' }
    },
    create: () => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      transports: {
        file: { ...mockTransport },
        console: { level: 'info', format: '' }
      }
    })
  }
  return { default: mockLogger }
})

// ===== Mock ConfigStore =====

let mockConfigStoreInstance: {
  patch: ReturnType<typeof vi.fn>
  getAll: ReturnType<typeof vi.fn>
} | null = null

vi.mock('@main/common/config/ConfigStore', () => ({
  get configStoreInstance() {
    return mockConfigStoreInstance
  }
}))

// ===== Import =====

import { configPatchTool } from '../config_patch'
import type { ToolResult, ToolStreamUpdate } from '../../types'

// ===== Helper =====

async function executeTool(
  params: Record<string, unknown>
): Promise<{ result: ToolResult; updates: ToolStreamUpdate[] }> {
  const updates: ToolStreamUpdate[] = []
  const gen = configPatchTool.execute(params)
  let step = await gen.next()
  while (!step.done) {
    updates.push(step.value as ToolStreamUpdate)
    step = await gen.next()
  }
  return { result: step.value as ToolResult, updates }
}

// ===== Tests =====

describe('config_patch 工具', () => {
  beforeEach(() => {
    mockConfigStoreInstance = {
      patch: vi.fn(),
      getAll: vi.fn().mockReturnValue({})
    }
  })

  afterEach(() => {
    mockConfigStoreInstance = null
    vi.restoreAllMocks()
  })

  // --- 基本功能 ---

  describe('正常 patch 应用', () => {
    it('成功应用简单配置补丁', async () => {
      const { result } = await executeTool({
        patch: '{"security": {"sandbox": {"mode": "off"}}}',
        description: '关闭沙箱'
      })

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Successfully applied')
      expect(result.llmContent).toContain('关闭沙箱')
      expect(result.llmContent).toContain('security')
      expect(mockConfigStoreInstance!.patch).toHaveBeenCalledWith({
        security: { sandbox: { mode: 'off' } }
      })
    })

    it('成功应用多段配置补丁', async () => {
      const patch = JSON.stringify({
        security: { approvals: { exec: 'never' } },
        logging: { level: 'debug' }
      })

      const { result } = await executeTool({ patch })

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('security')
      expect(result.llmContent).toContain('logging')
      expect(mockConfigStoreInstance!.patch).toHaveBeenCalledWith({
        security: { approvals: { exec: 'never' } },
        logging: { level: 'debug' }
      })
    })

    it('JSON5 格式支持（尾逗号、注释）', async () => {
      const { result } = await executeTool({
        patch: `{
          // 关闭沙箱
          security: { sandbox: { mode: 'off', }, },
        }`
      })

      expect(result.success).toBe(true)
      expect(mockConfigStoreInstance!.patch).toHaveBeenCalledWith({
        security: { sandbox: { mode: 'off' } }
      })
    })

    it('没有 description 时使用默认描述', async () => {
      const { result } = await executeTool({
        patch: '{"ui": {"theme": "dark"}}'
      })

      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Config update')
    })
  })

  // --- 错误处理 ---

  describe('输入校验', () => {
    it('无效 JSON5 返回解析错误', async () => {
      const { result } = await executeTool({
        patch: '{invalid json!!!}'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_JSON5')
    })

    it('数组类型 patch 被拒绝', async () => {
      const { result } = await executeTool({
        patch: '[1, 2, 3]'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_PATCH')
      expect(result.llmContent).toContain('object')
    })

    it('原始值 patch 被拒绝', async () => {
      const { result } = await executeTool({
        patch: '"just a string"'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_PATCH')
    })

    it('null patch 被拒绝', async () => {
      const { result } = await executeTool({
        patch: 'null'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_PATCH')
    })
  })

  describe('ConfigStore 错误处理', () => {
    it('ConfigStore 未初始化时返回错误', async () => {
      mockConfigStoreInstance = null

      const { result } = await executeTool({
        patch: '{"ui": {"theme": "dark"}}'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_INITIALIZED')
    })

    it('patch() 抛出 Schema 校验错误时返回错误', async () => {
      mockConfigStoreInstance!.patch.mockImplementation(() => {
        throw new Error('Config validation failed: invalid enum value at security.sandbox.mode')
      })

      const { result } = await executeTool({
        patch: '{"security": {"sandbox": {"mode": "invalid"}}}'
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PATCH_FAILED')
      expect(result.llmContent).toContain('validation failed')
    })
  })

  // --- 流式更新 ---

  describe('流式进度更新', () => {
    it('执行过程中发出 progress 更新', async () => {
      const { updates } = await executeTool({
        patch: '{"ui": {"theme": "dark"}}',
        description: '切换暗色主题'
      })

      const progressUpdates = updates.filter((u) => u.type === 'progress')
      expect(progressUpdates.length).toBeGreaterThanOrEqual(1)
      expect(progressUpdates[0].content).toContain('切换暗色主题')
    })

    it('成功时发出 output 更新', async () => {
      const { updates } = await executeTool({
        patch: '{"ui": {"theme": "dark"}}'
      })

      const outputUpdates = updates.filter((u) => u.type === 'output')
      expect(outputUpdates.length).toBe(1)
      expect(outputUpdates[0].content).toContain('Successfully')
    })
  })

  // --- 工具元数据 ---

  describe('工具定义元数据', () => {
    it('需要用户确认', () => {
      expect(configPatchTool.needUserConfirm).toBe(true)
    })

    it('名称正确', () => {
      expect(configPatchTool.name).toBe('config_patch')
    })

    it('类别为 Configuration', () => {
      expect(configPatchTool.category).toBe('configuration')
    })
  })
})
