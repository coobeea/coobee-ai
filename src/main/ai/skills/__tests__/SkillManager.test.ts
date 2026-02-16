/**
 * SkillManager 单元测试
 *
 * 测试：
 *   - parseSkillMd: SKILL.md 文件解析（frontmatter + 正文 + config）
 *   - scanSkills: 多路径扫描与去重
 *   - register / unregister: 动态增删
 *   - getAll / getByName / size: 查询
 *   - toPromptBlocks: XML 格式化输出
 *   - Skill 配置注入：configSchema + configStatus
 *   - clear: 清理状态
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import JSON5 from 'json5'
import path from 'path'

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import { SkillManager, parseSkillMd } from '../SkillManager'

describe('SkillManager', () => {
  // ==================== parseSkillMd ====================

  describe('parseSkillMd', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = path.join('/tmp', `skillmanager-test-${Date.now()}`)
      fs.mkdirSync(path.join(tmpDir, 'test-skill'), { recursive: true })
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('解析 frontmatter 中的 name 和 description', () => {
      const content = `---
name: My Skill
description: A test skill
---

# My Skill

Content here.`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('My Skill')
      expect(result!.description).toBe('A test skill')
      expect(result!.content).toBe('# My Skill\n\nContent here.')
    })

    it('无 frontmatter 时用目录名作为 name', () => {
      const content = `# Plain Skill\n\nNo frontmatter.`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('test-skill')
      expect(result!.description).toBe('')
      expect(result!.content).toBe('# Plain Skill\n\nNo frontmatter.')
    })

    it('frontmatter 缺少 name 时用目录名', () => {
      const content = `---
description: Only description
---

Content.`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result!.name).toBe('test-skill')
      expect(result!.description).toBe('Only description')
    })

    it('frontmatter 缺少 description 时返回空字符串', () => {
      const content = `---
name: Named Skill
---

Content.`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result!.name).toBe('Named Skill')
      expect(result!.description).toBe('')
    })

    it('文件不存在时返回 null', () => {
      const result = parseSkillMd('/nonexistent/SKILL.md')

      expect(result).toBeNull()
    })

    it('空文件返回空内容', () => {
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, '')

      const result = parseSkillMd(filePath)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('test-skill')
      expect(result!.content).toBe('')
    })

    it('解析 frontmatter 中的 config 字段', () => {
      const content = `---
name: paddle-ocr
description: OCR tool
config:
  - key: apiKey
    description: PaddleOCR API Key
    required: true
  - key: baseUrl
    description: API 地址
    required: false
    default: https://api.example.com
---

# PaddleOCR`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result).not.toBeNull()
      expect(result!.configSchema).toBeDefined()
      expect(result!.configSchema).toHaveLength(2)
      expect(result!.configSchema![0]).toEqual({
        key: 'apiKey',
        description: 'PaddleOCR API Key',
        required: true
      })
      expect(result!.configSchema![1]).toEqual({
        key: 'baseUrl',
        description: 'API 地址',
        required: false,
        default: 'https://api.example.com'
      })
    })

    it('无 config 字段时 configSchema 为 undefined', () => {
      const content = `---
name: simple-skill
description: No config needed
---

Content.`
      const filePath = path.join(tmpDir, 'test-skill', 'SKILL.md')
      fs.writeFileSync(filePath, content)

      const result = parseSkillMd(filePath)

      expect(result).not.toBeNull()
      expect(result!.configSchema).toBeUndefined()
    })
  })

  // ==================== scanSkills ====================

  describe('scanSkills', () => {
    let tmpDir: string
    let manager: SkillManager

    beforeEach(() => {
      tmpDir = path.join(
        '/tmp',
        `skillmanager-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      fs.mkdirSync(tmpDir, { recursive: true })
      SkillManager.invalidateCache()
      manager = new SkillManager()
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    function createSkill(baseDir: string, dirName: string, name: string, desc: string): void {
      const dir = path.join(baseDir, dirName)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nContent for ${name}.`
      )
    }

    it('扫描单个目录下的所有 Skill', () => {
      createSkill(tmpDir, 'skill-a', 'Skill A', 'Desc A')
      createSkill(tmpDir, 'skill-b', 'Skill B', 'Desc B')

      const skills = manager.scanSkills([tmpDir])

      expect(skills).toHaveLength(2)
      expect(manager.size).toBe(2)
      const names = skills.map((s) => s.name).sort()
      expect(names).toEqual(['Skill A', 'Skill B'])
    })

    it('扫描多个目录', () => {
      const dir1 = path.join(tmpDir, 'builtin')
      const dir2 = path.join(tmpDir, 'user')
      fs.mkdirSync(dir1, { recursive: true })
      fs.mkdirSync(dir2, { recursive: true })

      createSkill(dir1, 'skill-a', 'Builtin A', 'Builtin')
      createSkill(dir2, 'skill-b', 'User B', 'User')

      const skills = manager.scanSkills([dir1, dir2])

      expect(skills).toHaveLength(2)
      expect(manager.getByName('Builtin A')).toBeDefined()
      expect(manager.getByName('User B')).toBeDefined()
    })

    it('同名目录后发现覆盖先发现（高优先级覆盖低优先级）', () => {
      const dir1 = path.join(tmpDir, 'builtin')
      const dir2 = path.join(tmpDir, 'user')
      fs.mkdirSync(dir1, { recursive: true })
      fs.mkdirSync(dir2, { recursive: true })

      createSkill(dir1, 'runtime-env', 'Builtin Env', 'Builtin version')
      createSkill(dir2, 'runtime-env', 'User Env', 'User version')

      const skills = manager.scanSkills([dir1, dir2])

      // 后扫描的 dir2（用户级）覆盖 dir1（内置），最终只保留 1 个
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('User Env')
      expect(skills[0].description).toBe('User version')
    })

    it('三级优先级覆盖：内置 → 用户 → 工作空间', () => {
      const builtin = path.join(tmpDir, 'builtin')
      const user = path.join(tmpDir, 'user')
      const workspace = path.join(tmpDir, 'workspace')
      fs.mkdirSync(builtin, { recursive: true })
      fs.mkdirSync(user, { recursive: true })
      fs.mkdirSync(workspace, { recursive: true })

      createSkill(builtin, 'my-skill', 'Builtin Ver', 'V1 builtin')
      createSkill(user, 'my-skill', 'User Ver', 'V2 user')
      createSkill(workspace, 'my-skill', 'Workspace Ver', 'V3 workspace')

      const skills = manager.scanSkills([builtin, user, workspace])

      // 工作空间（最高优先级）覆盖
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('Workspace Ver')
      expect(skills[0].description).toBe('V3 workspace')
    })

    it('跳过隐藏目录', () => {
      createSkill(tmpDir, '.hidden', 'Hidden', 'Should not load')
      createSkill(tmpDir, 'visible', 'Visible', 'Should load')

      const skills = manager.scanSkills([tmpDir])

      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('Visible')
    })

    it('跳过没有 SKILL.md 的目录', () => {
      fs.mkdirSync(path.join(tmpDir, 'no-skill'), { recursive: true })
      createSkill(tmpDir, 'has-skill', 'Has Skill', 'Valid')

      const skills = manager.scanSkills([tmpDir])

      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('Has Skill')
    })

    it('不存在的目录不报错', () => {
      const skills = manager.scanSkills(['/nonexistent/path'])

      expect(skills).toHaveLength(0)
      expect(manager.size).toBe(0)
    })

    it('空目录返回空数组', () => {
      const skills = manager.scanSkills([tmpDir])

      expect(skills).toHaveLength(0)
    })

    it('跳过文件（非目录）', () => {
      fs.writeFileSync(path.join(tmpDir, 'not-a-dir.txt'), 'hello')
      createSkill(tmpDir, 'valid', 'Valid', 'V')

      const skills = manager.scanSkills([tmpDir])

      expect(skills).toHaveLength(1)
    })
  })

  // ==================== register / unregister ====================

  describe('register / unregister', () => {
    let manager: SkillManager

    beforeEach(() => {
      manager = new SkillManager()
    })

    it('register 添加新 Skill', () => {
      manager.register({ name: 'ext-skill', description: 'From extension', content: '...' })

      expect(manager.size).toBe(1)
      expect(manager.getByName('ext-skill')).toBeDefined()
      expect(manager.getByName('ext-skill')!.description).toBe('From extension')
    })

    it('register 同名覆盖', () => {
      manager.register({ name: 'skill-a', description: 'V1', content: 'v1' })
      manager.register({ name: 'skill-a', description: 'V2', content: 'v2' })

      expect(manager.size).toBe(1)
      expect(manager.getByName('skill-a')!.description).toBe('V2')
    })

    it('unregister 移除已存在的 Skill', () => {
      manager.register({ name: 'temp', description: '', content: '' })

      const removed = manager.unregister('temp')

      expect(removed).toBe(true)
      expect(manager.size).toBe(0)
      expect(manager.getByName('temp')).toBeUndefined()
    })

    it('unregister 不存在的 Skill 返回 false', () => {
      const removed = manager.unregister('not-exist')

      expect(removed).toBe(false)
    })
  })

  // ==================== getAll / getByName ====================

  describe('getAll / getByName', () => {
    let manager: SkillManager

    beforeEach(() => {
      manager = new SkillManager()
      manager.register({ name: 'a', description: 'A', content: 'aaa' })
      manager.register({ name: 'b', description: 'B', content: 'bbb' })
    })

    it('getAll 返回所有 Skill', () => {
      const all = manager.getAll()

      expect(all).toHaveLength(2)
      const names = all.map((s) => s.name).sort()
      expect(names).toEqual(['a', 'b'])
    })

    it('getByName 返回正确的 Skill', () => {
      const skill = manager.getByName('a')

      expect(skill).toBeDefined()
      expect(skill!.content).toBe('aaa')
    })

    it('getByName 不存在时返回 undefined', () => {
      expect(manager.getByName('nonexistent')).toBeUndefined()
    })
  })

  // ==================== toPromptBlocks ====================

  describe('toPromptBlocks', () => {
    let manager: SkillManager

    beforeEach(() => {
      manager = new SkillManager()
    })

    it('空列表返回空字符串', () => {
      expect(manager.toPromptBlocks()).toBe('')
    })

    it('生成正确的 <skill> XML 块', () => {
      manager.register({ name: 'skill-a', description: 'A', content: '# Skill A\ncontent' })
      manager.register({ name: 'skill-b', description: 'B', content: '# Skill B\ncontent' })

      const blocks = manager.toPromptBlocks()

      expect(blocks).toContain('<skill name="skill-a">')
      expect(blocks).toContain('# Skill A')
      expect(blocks).toContain('</skill>')
      expect(blocks).toContain('<skill name="skill-b">')
      expect(blocks).toContain('# Skill B')
    })

    it('XML 块之间有双空行分隔', () => {
      manager.register({ name: 'a', description: '', content: 'A' })
      manager.register({ name: 'b', description: '', content: 'B' })

      const blocks = manager.toPromptBlocks()

      expect(blocks).toContain('</skill>\n\n<skill')
    })
  })

  // ==================== Skill 配置注入 ====================

  describe('Skill 配置注入', () => {
    let tmpDir: string
    let configDir: string
    let manager: SkillManager

    beforeEach(() => {
      tmpDir = path.join(
        '/tmp',
        `skillmanager-config-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      configDir = path.join(tmpDir, 'config')
      fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true })
      fs.mkdirSync(configDir, { recursive: true })
      SkillManager.invalidateCache()
      manager = new SkillManager()
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    function createSkillWithConfig(dirName: string, name: string, configFields: string): void {
      const dir = path.join(tmpDir, 'skills', dirName)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Test\nconfig:\n${configFields}---\n\n# ${name}`
      )
    }

    it('配置齐全时 configStatus 为 configured', () => {
      createSkillWithConfig(
        'ocr',
        'paddle-ocr',
        '  - key: apiKey\n    description: Key\n    required: true\n'
      )
      fs.writeFileSync(
        path.join(configDir, 'skills.json5'),
        JSON5.stringify({ 'paddle-ocr': { apiKey: 'sk-xxx' } })
      )

      const skills = manager.scanSkills([path.join(tmpDir, 'skills')], configDir)

      expect(skills).toHaveLength(1)
      expect(skills[0].configStatus).toBe('configured')
    })

    it('配置缺失时 configStatus 为 missing', () => {
      createSkillWithConfig(
        'ocr',
        'paddle-ocr',
        '  - key: apiKey\n    description: Key\n    required: true\n'
      )
      // 空的 skills.json5
      fs.writeFileSync(path.join(configDir, 'skills.json5'), '{}')

      const skills = manager.scanSkills([path.join(tmpDir, 'skills')], configDir)

      expect(skills[0].configStatus).toBe('missing')
    })

    it('部分配置时 configStatus 为 partial', () => {
      createSkillWithConfig(
        'ocr',
        'paddle-ocr',
        '  - key: apiKey\n    description: Key\n    required: true\n  - key: secret\n    description: Secret\n    required: true\n'
      )
      // 只填了一个 required 字段
      fs.writeFileSync(
        path.join(configDir, 'skills.json5'),
        JSON5.stringify({ 'paddle-ocr': { apiKey: 'sk-xxx' } })
      )

      const skills = manager.scanSkills([path.join(tmpDir, 'skills')], configDir)

      expect(skills[0].configStatus).toBe('partial')
    })

    it('无配置需求的 Skill 没有 configStatus', () => {
      const dir = path.join(tmpDir, 'skills', 'simple')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        '---\nname: simple\ndescription: No config\n---\n\nContent'
      )

      const skills = manager.scanSkills([path.join(tmpDir, 'skills')], configDir)

      expect(skills[0].configStatus).toBeUndefined()
    })

    it('getSkillRuntimeConfig 返回正确的配置', () => {
      createSkillWithConfig(
        'ocr',
        'paddle-ocr',
        '  - key: apiKey\n    description: Key\n    required: true\n'
      )
      fs.writeFileSync(
        path.join(configDir, 'skills.json5'),
        JSON5.stringify({ 'paddle-ocr': { apiKey: 'sk-xxx', baseUrl: 'https://api.example.com' } })
      )

      manager.scanSkills([path.join(tmpDir, 'skills')], configDir)
      const config = manager.getSkillRuntimeConfig('paddle-ocr')

      expect(config).toEqual({ apiKey: 'sk-xxx', baseUrl: 'https://api.example.com' })
    })

    it('getSkillRuntimeConfig 未配置时返回 undefined', () => {
      fs.writeFileSync(path.join(configDir, 'skills.json5'), '{}')

      manager.scanSkills([path.join(tmpDir, 'skills')], configDir)
      const config = manager.getSkillRuntimeConfig('nonexistent')

      expect(config).toBeUndefined()
    })

    it('toPromptBlocks 包含配置状态属性', () => {
      createSkillWithConfig(
        'ocr',
        'paddle-ocr',
        '  - key: apiKey\n    description: Key\n    required: true\n'
      )
      fs.writeFileSync(path.join(configDir, 'skills.json5'), '{}')

      manager.scanSkills([path.join(tmpDir, 'skills')], configDir)
      const blocks = manager.toPromptBlocks()

      expect(blocks).toContain('config-status="missing"')
    })
  })

  // ==================== clear ====================

  describe('clear', () => {
    it('清空所有已加载的 Skill', () => {
      const manager = new SkillManager()
      manager.register({ name: 'a', description: '', content: '' })
      manager.register({ name: 'b', description: '', content: '' })

      manager.clear()

      expect(manager.size).toBe(0)
      expect(manager.getAll()).toHaveLength(0)
    })

    it('clear 后可以重新加载', () => {
      const tmpDir = path.join('/tmp', `skillmanager-clear-${Date.now()}`)
      const skillDir = path.join(tmpDir, 'my-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: My Skill\ndescription: test\n---\n\nContent'
      )

      const manager = new SkillManager()
      manager.scanSkills([tmpDir])
      expect(manager.size).toBe(1)

      manager.clear()
      expect(manager.size).toBe(0)

      // 重新扫描应该再次加载
      manager.scanSkills([tmpDir])
      expect(manager.size).toBe(1)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })
})
