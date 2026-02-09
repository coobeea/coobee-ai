/**
 * Mock DatabaseService
 * 替代真实的 SQLite 数据库操作
 */
import { vi } from 'vitest'

export function createMockDatabaseService(): Record<string, unknown> {
  const data = new Map<string, unknown[]>()

  return {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([])
    }),
    // 辅助方法：设置模拟数据
    _setData: (table: string, rows: unknown[]) => {
      data.set(table, rows)
    },
    _getData: (table: string) => data.get(table) || []
  }
}

/**
 * Mock AgentConfigStore
 */
export function createMockAgentConfigStore(): Record<string, unknown> {
  const configs = new Map<string, Record<string, unknown>>()

  return {
    getConfig: vi.fn(async (id: string) => configs.get(id) || null),
    saveConfig: vi.fn(async (config: Record<string, unknown>) => {
      configs.set(config.id as string, config)
    }),
    deleteConfig: vi.fn(async (id: string) => {
      configs.delete(id)
    }),
    listConfigs: vi.fn(async () => Array.from(configs.values())),
    // 辅助方法
    _setConfig: (id: string, config: Record<string, unknown>) => {
      configs.set(id, config)
    }
  }
}
