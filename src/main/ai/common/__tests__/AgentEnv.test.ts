/**
 * AgentEnv 单元测试
 *
 * 测试：
 *   - buildAgentEnv: 从 Env 构建安全子集
 *   - formatRuntimePaths: 格式化为 <runtime_paths> XML
 *   - loadRuntimeEnvSkill: 加载内置 runtime-env Skill
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// ===== Mock env =====
const mockEnv = {
  isDev: true,
  paths: {
    userHome: '/mock/.home',
    temp: '/tmp/mock',
    builtinSkillsDir: '/mock/skills',
    userSkillsDir: '/mock/.home/skills',
    memoryDir: '/mock/.home/memory',
    userMemoryDir: '/mock/.home/memory/user',
    agentMemoryDir: '/mock/.home/memory/agent',
    workspacesDir: '/mock/.home/workspaces',
    configDir: '/mock/.home/config'
  },
  getSkillSearchPaths: vi.fn(),
  getExtensionSearchPaths: vi.fn(),
  getAgentWorkspaceDir: vi.fn()
}

vi.mock('@main/common/env', () => ({
  Env: mockEnv
}))

import { buildAgentEnv, formatRuntimePaths, loadRuntimeEnvSkill } from '../AgentEnv'
import type { AgentEnv } from '../AgentEnv'

describe('AgentEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==================== buildAgentEnv ====================

  describe('buildAgentEnv', () => {
    it('从 Env 构建包含所有必要字段的安全子集', async () => {
      const mockSkillPaths = ['/mock/skills', '/mock/.home/skills', '/mock/workspace/skills']
      const mockExtPaths = ['/mock/extensions', '/mock/.home/extensions']
      mockEnv.getSkillSearchPaths.mockResolvedValue(mockSkillPaths)
      mockEnv.getExtensionSearchPaths.mockResolvedValue(mockExtPaths)

      const env = await buildAgentEnv('/mock/workspace')

      expect(env).toEqual({
        workspace: '/mock/workspace',
        userHome: '/mock/.home',
        temp: '/tmp/mock',
        platform: process.platform,
        isDev: true,
        skillPaths: mockSkillPaths,
        builtinSkillsDir: '/mock/skills',
        userSkillsDir: '/mock/.home/skills',
        memoryDir: '/mock/.home/memory',
        extensionPaths: mockExtPaths
      })
    })

    it('调用 getSkillSearchPaths 并传入 workspace', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([])
      mockEnv.getExtensionSearchPaths.mockResolvedValue([])

      await buildAgentEnv('/my/workspace')

      expect(mockEnv.getSkillSearchPaths).toHaveBeenCalledWith('/my/workspace')
      expect(mockEnv.getExtensionSearchPaths).toHaveBeenCalledWith('/my/workspace')
    })
  })

  // ==================== formatRuntimePaths ====================

  describe('formatRuntimePaths', () => {
    const sampleEnv: AgentEnv = {
      workspace: '/home/test/workspaces/session-1',
      userHome: '/home/test',
      temp: '/tmp',
      platform: 'darwin',
      isDev: true,
      skillPaths: [
        '/builtin/skills',
        '/home/test/skills',
        '/home/test/workspaces/session-1/skills'
      ],
      builtinSkillsDir: '/builtin/skills',
      userSkillsDir: '/home/test/skills',
      extensionPaths: ['/builtin/extensions', '/home/test/extensions'],
      memoryDir: '/home/test/memory'
    }

    it('生成包含所有路径的 XML 块', () => {
      const result = formatRuntimePaths(sampleEnv)

      expect(result).toContain('<runtime_paths>')
      expect(result).toContain('</runtime_paths>')
      expect(result).toContain(`<workspace>${sampleEnv.workspace}</workspace>`)
      expect(result).toContain(`<userHome>${sampleEnv.userHome}</userHome>`)
      expect(result).toContain(`<temp>${sampleEnv.temp}</temp>`)
      expect(result).toContain(`<builtinSkillsDir>${sampleEnv.builtinSkillsDir}</builtinSkillsDir>`)
      expect(result).toContain(`<userSkillsDir>${sampleEnv.userSkillsDir}</userSkillsDir>`)
      expect(result).toContain(`<memoryDir>${sampleEnv.memoryDir}</memoryDir>`)
      expect(result).toContain(`<platform>darwin</platform>`)
      expect(result).toContain(`<isDev>true</isDev>`)
    })

    it('包含所有 skillPaths', () => {
      const result = formatRuntimePaths(sampleEnv)

      for (const p of sampleEnv.skillPaths) {
        expect(result).toContain(`<path>${p}</path>`)
      }
    })

    it('skillPaths 为空时仍能正确输出', () => {
      const emptySkills = { ...sampleEnv, skillPaths: [] }
      const result = formatRuntimePaths(emptySkills)

      expect(result).toContain('<skillPaths>')
      expect(result).toContain('</skillPaths>')
      // 不包含 <path> 子元素
      expect(result).not.toContain('<path>')
    })
  })

  // ==================== loadRuntimeEnvSkill ====================

  describe('loadRuntimeEnvSkill', () => {
    let tmpDir: string

    beforeEach(() => {
      // 创建临时目录用于测试
      tmpDir = path.join('/tmp', `agentenv-test-${Date.now()}`)
      fs.mkdirSync(path.join(tmpDir, 'runtime-env'), { recursive: true })
    })

    afterEach(() => {
      // 清理临时目录
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('成功加载 SKILL.md 并解析 frontmatter', async () => {
      const skillContent = `---
name: Runtime Environment
description: Test description
---

# Runtime Environment

This is the skill content.`

      fs.writeFileSync(path.join(tmpDir, 'runtime-env', 'SKILL.md'), skillContent)

      const skill = await loadRuntimeEnvSkill(tmpDir)

      expect(skill).not.toBeNull()
      expect(skill!.name).toBe('runtime-env')
      expect(skill!.description).toBe('Agent 运行时环境的目录结构、路径约定和可用资源说明')
      expect(skill!.content).toContain('# Runtime Environment')
      expect(skill!.content).toContain('This is the skill content.')
      // frontmatter 不应该出现在 content 中
      expect(skill!.content).not.toContain('---')
    })

    it('没有 frontmatter 时返回完整内容', async () => {
      const skillContent = `# Runtime Environment\n\nNo frontmatter here.`
      fs.writeFileSync(path.join(tmpDir, 'runtime-env', 'SKILL.md'), skillContent)

      const skill = await loadRuntimeEnvSkill(tmpDir)

      expect(skill).not.toBeNull()
      expect(skill!.content).toContain('# Runtime Environment')
      expect(skill!.content).toContain('No frontmatter here.')
    })

    it('目录不存在时返回 null', async () => {
      const skill = await loadRuntimeEnvSkill('/nonexistent/path')

      expect(skill).toBeNull()
    })

    it('SKILL.md 文件不存在时返回 null', async () => {
      // tmpDir 存在但没有 SKILL.md
      fs.rmSync(path.join(tmpDir, 'runtime-env', 'SKILL.md'), { force: true })

      const skill = await loadRuntimeEnvSkill(tmpDir)

      expect(skill).toBeNull()
    })
  })
})
