/**
 * 内置工具测试
 *
 * 验证内置工具（readFileTool, webSearchTool）的定义和执行
 */
import { describe, it, expect, vi } from 'vitest'

// Mock @openai/agents 的 tool 函数，保留原始调用参数
vi.mock('@openai/agents', () => ({
  tool: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    type: 'function',
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute
  }))
}))

// Mock fs
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: vi.fn()
}))

import { readFileTool, webSearchTool, builtinTools } from '../builtin/index'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

// Mock 返回的工具对象包含 execute 方法（FunctionTool 类型中为 invoke）
// 辅助函数用于在测试中安全调用 mock 工具的 execute
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any, args: Record<string, any>): Promise<string> => t.execute(args)

describe('内置工具', () => {
  // ========== readFileTool ==========

  describe('readFileTool', () => {
    it('工具名称为 read_file', () => {
      expect(readFileTool.name).toBe('read_file')
    })

    it('包含描述信息', () => {
      expect(readFileTool.description).toBeDefined()
    })

    it('包含 parameters 定义', () => {
      expect(readFileTool.parameters).toBeDefined()
    })

    it('文件存在时返回文件内容', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFile).mockResolvedValue('hello world')

      const result = await exec(readFileTool, { path: '/tmp/test.txt' })
      const parsed = JSON.parse(result as string)

      expect(parsed.success).toBe(true)
      expect(parsed.content).toBe('hello world')
      expect(parsed.size).toBe(11)
    })

    it('文件不存在时返回错误', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = await exec(readFileTool, { path: '/tmp/nope.txt' })
      const parsed = JSON.parse(result as string)

      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('文件不存在')
    })

    it('读取异常时返回错误', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFile).mockRejectedValue(new Error('Permission denied'))

      const result = await exec(readFileTool, { path: '/tmp/protected.txt' })
      const parsed = JSON.parse(result as string)

      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('Permission denied')
    })
  })

  // ========== webSearchTool ==========

  describe('webSearchTool', () => {
    it('工具名称为 web_search', () => {
      expect(webSearchTool.name).toBe('web_search')
    })

    it('包含描述信息', () => {
      expect(webSearchTool.description).toBeDefined()
    })

    it('执行返回模拟搜索结果', async () => {
      const result = await exec(webSearchTool, { query: 'test query' })
      const parsed = JSON.parse(result as string)

      expect(parsed.success).toBe(true)
      expect(parsed.query).toBe('test query')
      expect(parsed.results).toBeDefined()
      expect(Array.isArray(parsed.results)).toBe(true)
    })
  })

  // ========== builtinTools 集合 ==========

  describe('builtinTools 集合', () => {
    it('包含 2 个内置工具', () => {
      expect(builtinTools).toHaveLength(2)
    })

    it('包含 readFileTool 和 webSearchTool', () => {
      expect(builtinTools).toContain(readFileTool)
      expect(builtinTools).toContain(webSearchTool)
    })
  })
})
