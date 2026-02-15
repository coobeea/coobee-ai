/**
 * Observability & Discovery 工具测试
 *
 * 测试 session_status、session_history、context_inspect、skill_list 4 个工具。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ToolResult, ToolStreamUpdate } from '../types'

// ========== Mock logger ==========
vi.mock('@main/common/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { default: log, log }
})

// ========== Mock Env（exec/process/memory 依赖） ==========
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userHome: '/mock/.home',
      memoryDir: '/mock/.home/memory'
    }
  }
}))

// ========== 工具引用 ==========
import { sessionStatusTool } from '../builtin/session_status'
import { sessionHistoryTool } from '../builtin/session_history'
import { contextInspectTool } from '../builtin/context_inspect'
import { skillListTool } from '../builtin/skill_list'
import { SkillManager } from '../../skills'

// ========== 辅助函数 ==========

/** 消费 AsyncGenerator，收集 yields 和 return */
async function consumeGenerator(
  gen: AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>
): Promise<{ updates: ToolStreamUpdate[]; result: ToolResult }> {
  const updates: ToolStreamUpdate[] = []
  let r = await gen.next()
  while (!r.done) {
    updates.push(r.value as ToolStreamUpdate)
    r = await gen.next()
  }
  return { updates, result: r.value }
}

/** 创建临时 contexts 目录并写入快照 */
function createContexts(
  workspaceDir: string,
  snapshots: Array<{ filename: string; data: Record<string, unknown> }>
): string {
  const contextsDir = path.join(workspaceDir, 'contexts')
  fs.mkdirSync(contextsDir, { recursive: true })
  for (const snap of snapshots) {
    fs.writeFileSync(path.join(contextsDir, snap.filename), JSON.stringify(snap.data), 'utf-8')
  }
  return contextsDir
}

// ========== 测试 ==========

describe('Observability & Discovery Tools', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-tools-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ==============================================
  // session_status
  // ==============================================
  describe('session_status', () => {
    it('工具元数据正确', () => {
      expect(sessionStatusTool.name).toBe('session_status')
      expect(sessionStatusTool.needUserConfirm).toBe(false)
      expect(sessionStatusTool.category).toBe('observability')
    })

    it('无 workspace 时返回错误', async () => {
      const gen = sessionStatusTool.execute({}, undefined, undefined)
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(false)
      expect(result.llmContent).toContain('workspace')
    })

    it('无 contexts 目录时返回 0 快照', async () => {
      const gen = sessionStatusTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        sessionId: 'test-session',
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Snapshots: 0')
      expect(result.llmContent).toContain('test-session')
    })

    it('正确读取最近一次快照信息', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: {
            timestamp: '2026-02-14T10:00:00.000Z',
            config: { model: 'gpt-4' },
            duration: 1500,
            toolCalls: [{ toolName: 'read', arguments: {} }]
          }
        },
        {
          filename: '2026-02-14T11-00-00-000.json',
          data: {
            timestamp: '2026-02-14T11:00:00.000Z',
            config: { model: 'qwen3-max' },
            duration: 2000
          }
        }
      ])

      const gen = sessionStatusTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        sessionId: 'sess-42',
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Snapshots: 2')
      expect(result.llmContent).toContain('qwen3-max')
      expect(result.llmContent).toContain('2000ms')
    })

    it('产生 progress yield', async () => {
      const gen = sessionStatusTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { updates } = await consumeGenerator(gen)
      expect(updates.length).toBeGreaterThanOrEqual(1)
      expect(updates[0].type).toBe('progress')
    })
  })

  // ==============================================
  // session_history
  // ==============================================
  describe('session_history', () => {
    it('工具元数据正确', () => {
      expect(sessionHistoryTool.name).toBe('session_history')
      expect(sessionHistoryTool.needUserConfirm).toBe(false)
      expect(sessionHistoryTool.category).toBe('observability')
    })

    it('无 workspace 时返回错误', async () => {
      const gen = sessionHistoryTool.execute({}, undefined, undefined)
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(false)
    })

    it('无快照时返回空历史', async () => {
      const gen = sessionHistoryTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('No conversation history')
    })

    it('正确生成历史时间线', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: {
            timestamp: '2026-02-14T10:00:00.000Z',
            config: { model: 'gpt-4' },
            duration: 500,
            userMessage: 'Hello world',
            toolCalls: [{ toolName: 'read', arguments: {} }]
          }
        },
        {
          filename: '2026-02-14T10-05-00-000.json',
          data: {
            timestamp: '2026-02-14T10:05:00.000Z',
            config: { model: 'qwen3-max' },
            duration: 1200,
            userMessage: 'What is the meaning of life?',
            toolCalls: []
          }
        }
      ])

      const gen = sessionHistoryTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('2/2 entries')
      expect(result.llmContent).toContain('gpt-4')
      expect(result.llmContent).toContain('qwen3-max')
      expect(result.llmContent).toContain('Hello world')
    })

    it('limit 参数限制条目数', async () => {
      const snapshots = Array.from({ length: 5 }, (_, i) => ({
        filename: `2026-02-14T10-0${i}-00-000.json`,
        data: {
          timestamp: `2026-02-14T10:0${i}:00.000Z`,
          config: { model: 'test' },
          userMessage: `msg-${i}`
        }
      }))
      createContexts(tmpDir, snapshots)

      const gen = sessionHistoryTool.execute({ limit: 2 }, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('2/5 entries')
      // 应该包含最后 2 条
      expect(result.llmContent).toContain('msg-3')
      expect(result.llmContent).toContain('msg-4')
      expect(result.llmContent).not.toContain('msg-0')
    })

    it('长消息被截断', async () => {
      const longMessage = 'A'.repeat(100)
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: {
            timestamp: '2026-02-14T10:00:00.000Z',
            config: { model: 'test' },
            userMessage: longMessage
          }
        }
      ])

      const gen = sessionHistoryTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('...')
    })
  })

  // ==============================================
  // context_inspect
  // ==============================================
  describe('context_inspect', () => {
    it('工具元数据正确', () => {
      expect(contextInspectTool.name).toBe('context_inspect')
      expect(contextInspectTool.needUserConfirm).toBe(false)
      expect(contextInspectTool.category).toBe('observability')
    })

    it('无 workspace 时返回错误', async () => {
      const gen = contextInspectTool.execute({ filename: 'test.json' }, undefined, undefined)
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(false)
    })

    it('文件不存在时返回错误', async () => {
      fs.mkdirSync(path.join(tmpDir, 'contexts'), { recursive: true })
      const gen = contextInspectTool.execute({ filename: 'nonexistent.json' }, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(false)
      expect(result.llmContent).toContain('not found')
    })

    it('正确显示完整快照信息', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: {
            timestamp: '2026-02-14T10:00:00.000Z',
            sessionId: 'sess-1',
            runtime: 'agent',
            duration: 1500,
            config: {
              name: 'chat-agent',
              model: 'qwen3-max',
              instructions: 'You are helpful.',
              skills: [{ name: 'runtime-env', description: 'ENV info' }],
              tools: [{ name: 'read' }, { name: 'write' }]
            },
            userMessage: 'Hello!',
            output: 'Hi there!',
            toolCalls: [{ toolName: 'read', arguments: { path: '/test' }, result: 'ok' }]
          }
        }
      ])

      const gen = contextInspectTool.execute(
        { filename: '2026-02-14T10-00-00-000.json' },
        undefined,
        { workspaceRoot: tmpDir, mode: 'path-only' as const, toolPolicy: { allow: [], deny: [] } }
      )
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Context Snapshot')
      expect(result.llmContent).toContain('qwen3-max')
      expect(result.llmContent).toContain('chat-agent')
      expect(result.llmContent).toContain('runtime-env')
      expect(result.llmContent).toContain('Hello!')
      expect(result.llmContent).toContain('Hi there!')
      expect(result.llmContent).toContain('1500ms')
      expect(result.llmContent).toContain('Tool Calls (1)')
    })

    it('"latest" 快捷方式读取最新快照', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: {
            timestamp: '2026-02-14T10:00:00.000Z',
            config: { model: 'old-model' },
            userMessage: 'first'
          }
        },
        {
          filename: '2026-02-14T11-00-00-000.json',
          data: {
            timestamp: '2026-02-14T11:00:00.000Z',
            config: { model: 'new-model' },
            userMessage: 'latest call'
          }
        }
      ])

      const gen = contextInspectTool.execute({ filename: 'latest' }, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('new-model')
      expect(result.llmContent).toContain('latest call')
    })

    it('自动补全 .json 后缀', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: { config: { model: 'test' }, userMessage: 'auto-ext' }
        }
      ])

      const gen = contextInspectTool.execute({ filename: '2026-02-14T10-00-00-000' }, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('auto-ext')
    })

    it('显示错误信息', async () => {
      createContexts(tmpDir, [
        {
          filename: '2026-02-14T10-00-00-000.json',
          data: { config: { model: 'test' }, error: 'API rate limit', userMessage: 'q' }
        }
      ])

      const gen = contextInspectTool.execute(
        { filename: '2026-02-14T10-00-00-000.json' },
        undefined,
        { workspaceRoot: tmpDir, mode: 'path-only' as const, toolPolicy: { allow: [], deny: [] } }
      )
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('API rate limit')
    })

    it('无 contexts 目录时返回错误', async () => {
      const gen = contextInspectTool.execute({ filename: 'latest' }, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(false)
      expect(result.llmContent).toContain('No contexts directory')
    })
  })

  // ==============================================
  // skill_list
  // ==============================================
  describe('skill_list', () => {
    beforeEach(() => {
      // 清理 SkillManager 全局状态
      SkillManager.setCurrent(null as unknown as SkillManager)
    })

    it('工具元数据正确', () => {
      expect(skillListTool.name).toBe('skill_list')
      expect(skillListTool.needUserConfirm).toBe(false)
      expect(skillListTool.category).toBe('discovery')
    })

    it('无 SkillManager 时返回空', async () => {
      const gen = skillListTool.execute({})
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('No Skills available')
    })

    it('正确列出所有 Skill', async () => {
      // 创建一个真实的 SkillManager 并注册 skills
      const mgr = new SkillManager()

      // 创建临时 skill 目录结构
      const skillsDir = path.join(tmpDir, 'skills')
      fs.mkdirSync(path.join(skillsDir, 'runtime-env'), { recursive: true })
      fs.writeFileSync(
        path.join(skillsDir, 'runtime-env', 'SKILL.md'),
        '---\nname: Runtime Environment\ndescription: 运行时环境说明\n---\n# Content here'
      )
      fs.mkdirSync(path.join(skillsDir, 'skill-creator'), { recursive: true })
      fs.writeFileSync(
        path.join(skillsDir, 'skill-creator', 'SKILL.md'),
        '---\nname: Skill Creator\ndescription: 创建 Skill\n---\n# Creator instructions'
      )

      mgr.scanSkills([skillsDir])
      SkillManager.setCurrent(mgr)

      const gen = skillListTool.execute({}, undefined, {
        workspaceRoot: tmpDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.success).toBe(true)
      expect(result.llmContent).toContain('Available Skills (2)')
      expect(result.llmContent).toContain('Runtime Environment')
      expect(result.llmContent).toContain('Skill Creator')
      expect(result.llmContent).toContain('运行时环境说明')
      expect(result.llmContent).toContain('SKILL.md')
      expect(result.llmContent).toContain('read')
    })

    it('包含 filePath 信息（workspace 内显示相对路径）', async () => {
      const mgr = new SkillManager()
      const skillsDir = path.join(tmpDir, 'skills2')
      fs.mkdirSync(path.join(skillsDir, 'test-skill'), { recursive: true })
      fs.writeFileSync(
        path.join(skillsDir, 'test-skill', 'SKILL.md'),
        '---\nname: Test\ndescription: A test\n---\n# Test'
      )

      mgr.scanSkills([skillsDir])
      SkillManager.setCurrent(mgr)

      const gen = skillListTool.execute({}, undefined, {
        workspaceRoot: skillsDir,
        mode: 'path-only' as const,
        toolPolicy: { allow: [], deny: [] }
      })
      const { result } = await consumeGenerator(gen)
      expect(result.llmContent).toContain('test-skill/SKILL.md')
    })

    it('产生 progress yield', async () => {
      const gen = skillListTool.execute({})
      const { updates } = await consumeGenerator(gen)
      expect(updates.length).toBeGreaterThanOrEqual(1)
      expect(updates[0].type).toBe('progress')
    })
  })
})
