/**
 * ToolRegistry 单元测试
 *
 * 测试工具注册、获取、批量操作
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../registry'

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    // 重置单例
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ToolRegistry as any).instance = undefined
    registry = ToolRegistry.getInstance()
  })

  describe('单例模式', () => {
    it('getInstance 返回同一实例', () => {
      const a = ToolRegistry.getInstance()
      const b = ToolRegistry.getInstance()
      expect(a).toBe(b)
    })
  })

  describe('register / get', () => {
    it('注册并获取工具', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockTool = { name: 'test_tool' } as any
      registry.register(mockTool)
      expect(registry.get('test_tool')).toBe(mockTool)
    })

    it('获取不存在的工具返回 undefined', () => {
      expect(registry.get('not_exist')).toBeUndefined()
    })

    it('重复注册抛出错误', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool1 = { name: 'dup' } as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool2 = { name: 'dup' } as any
      registry.register(tool1)
      expect(() => registry.register(tool2)).toThrow('Tool dup already registered')
    })
  })

  describe('registerAll / getAll', () => {
    it('批量注册工具', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = [{ name: 'a' } as any, { name: 'b' } as any, { name: 'c' } as any]
      registry.registerAll(tools)
      expect(registry.getAll()).toHaveLength(3)
    })

    it('getAll 返回所有已注册工具', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolA = { name: 'x' } as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolB = { name: 'y' } as any
      registry.register(toolA)
      registry.register(toolB)
      const all = registry.getAll()
      expect(all).toHaveLength(2)
      expect(all).toContain(toolA)
      expect(all).toContain(toolB)
    })

    it('空注册表返回空数组', () => {
      expect(registry.getAll()).toHaveLength(0)
    })
  })
})
