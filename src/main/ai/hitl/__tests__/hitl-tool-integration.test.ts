/**
 * HITL + 工具系统 集成测试
 *
 * HITL 审批已从 AgentExecutor 移至 tool-approval Extension（before_tool_call Hook）。
 *
 * 此文件保留工具定义元数据验证（needUserConfirm 配置正确性）。
 * HITL 审批流程测试应在 tool-approval Extension 的测试中覆盖。
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { ToolDefinition, ToolResult, ToolStreamUpdate } from '../../tools/types'
import { ToolCategory } from '../../tools/types'

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

// ===== Mock env =====
vi.mock('@main/common/env', () => ({
  Env: {
    isDev: true,
    paths: {
      userHome: '/tmp/test-home',
      temp: '/tmp',
      builtinSkillsDir: '/tmp/test-skills',
      userSkillsDir: '/tmp/test-home/skills',
      memoryDir: '/tmp/test-home/memory',
      userMemoryDir: '/tmp/test-home/memory/user',
      agentMemoryDir: '/tmp/test-home/memory/agent',
      workspacesDir: '/tmp/test-home/workspaces',
      configDir: '/tmp/test-home/config',
      userData: '/tmp/test-userData'
    }
  }
}))

// ===== 辅助工具定义 =====

function createMockTool(name: string, needUserConfirm: boolean): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    category: ToolCategory.Execute,
    parameters: z.object({
      input: z.string()
    }),
    needUserConfirm,
    execute: async function* (
      params: Record<string, unknown>
    ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
      yield { type: 'progress', content: `Executing ${name}...`, percentage: 50 }
      return {
        success: true,
        llmContent: `${name} result: ${params.input}`
      }
    }
  }
}

describe('HITL + 工具系统 — 工具定义元数据', () => {
  // ========== needUserConfirm 工具定义验证 ==========

  describe('needUserConfirm 工具元数据', () => {
    it('工具定义的 needUserConfirm=true 被正确声明', () => {
      const tool = createMockTool('dangerous_write', true)
      expect(tool.needUserConfirm).toBe(true)
    })

    it('工具定义的 needUserConfirm=false 被正确声明', () => {
      const tool = createMockTool('safe_read', false)
      expect(tool.needUserConfirm).toBe(false)
    })

    it('工具定义的 needUserConfirm 未设置时为 undefined', () => {
      const tool: ToolDefinition = {
        name: 'no_confirm_field',
        description: 'test',
        category: ToolCategory.FileSystem,
        parameters: z.object({}),
        // eslint-disable-next-line require-yield
        execute: async function* () {
          return { success: true, llmContent: 'ok' }
        }
      }
      expect(tool.needUserConfirm).toBeUndefined()
    })
  })

  // ========== 内置工具 needUserConfirm 配置验证 ==========

  describe('内置工具 needUserConfirm 配置', () => {
    it('builtinTools 的 needUserConfirm 配置与安全等级一致', async () => {
      const { builtinTools } = await import('../../tools/builtin')

      const toolMap = Object.fromEntries(builtinTools.map((t) => [t.name, t]))

      // read — 低风险，不需要确认
      expect(toolMap['read']?.needUserConfirm).toBe(false)
      // write — 中风险，需要确认
      expect(toolMap['write']?.needUserConfirm).toBe(true)
      // edit — 中风险，需要确认
      expect(toolMap['edit']?.needUserConfirm).toBe(true)
      // exec — 高风险，需要确认
      expect(toolMap['exec']?.needUserConfirm).toBe(true)
    })
  })
})
