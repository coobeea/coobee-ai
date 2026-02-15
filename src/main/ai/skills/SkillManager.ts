/**
 * Skill 管理器 — 文件驱动的 Skill 生命周期管理
 *
 * 职责：
 *   - 扫描目录下所有 SKILL.md 文件并解析 frontmatter
 *   - 支持多级搜索路径（内置 → Extension → 用户 → 工作空间），后到覆盖（高优先级覆盖低优先级）
 *   - 动态注册/注销（Extension 贡献）
 *   - 动态添加搜索路径
 *   - 查询（按名称、全量）
 *   - 格式化输出（生成 <skill> XML 块供提示词注入）
 *
 * 不负责：
 *   - 路径的定义和存储（由 Env 提供）
 *   - 环境信息的构建（由 AgentEnv 负责）
 */

import fs from 'fs'
import path from 'path'
import { log } from '@main/common/logger'
import type { SkillDefinition } from '../runtime/types'

// ==================== Skill 文件解析 ====================

/**
 * 解析 SKILL.md 文件内容，提取 frontmatter 中的 name/description 和正文
 *
 * @param filePath SKILL.md 文件的绝对路径
 * @returns 解析结果，或 null（文件不存在/解析失败）
 */
export function parseSkillMd(
  filePath: string
): { name: string; description: string; content: string } | null {
  try {
    if (!fs.existsSync(filePath)) return null

    const raw = fs.readFileSync(filePath, 'utf-8')

    // 解析 YAML frontmatter: ---\nkey: value\n---
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!fmMatch) {
      // 无 frontmatter，用目录名作为 name
      const dirName = path.basename(path.dirname(filePath))
      return { name: dirName, description: '', content: raw.trim() }
    }

    const frontmatter = fmMatch[1]
    const body = fmMatch[2].trim()

    // 简单解析 YAML（只取 name 和 description）
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

    const dirName = path.basename(path.dirname(filePath))
    return {
      name: nameMatch ? nameMatch[1].trim() : dirName,
      description: descMatch ? descMatch[1].trim() : '',
      content: body
    }
  } catch {
    return null
  }
}

// ==================== SkillManager ====================

export class SkillManager {
  /** 当前活跃的 SkillManager 实例（供 skill_list 工具访问） */
  private static currentInstance: SkillManager | null = null

  /** 设置当前活跃实例（由 AgentExecutor 在 injectEnv 时调用） */
  static setCurrent(manager: SkillManager): void {
    SkillManager.currentInstance = manager
  }

  /** 获取当前活跃实例 */
  static getCurrent(): SkillManager | null {
    return SkillManager.currentInstance
  }

  /** 已加载的 Skill（name → SkillDefinition） */
  private skills = new Map<string, SkillDefinition>()

  /** 目录名 → Skill name 的映射（用于后到覆盖时移除旧版本） */
  private dirNameToSkillName = new Map<string, string>()

  // ========== 扫描与加载 ==========

  /**
   * 扫描多个搜索路径，加载所有 SKILL.md
   *
   * 按搜索路径顺序扫描，**后到覆盖**（同名目录后发现的覆盖先发现的）。
   * 搜索路径顺序应为 低→高 优先级（内置 → Extension → 用户 → 工作空间）。
   * 这样工作空间中的同名 Skill 会覆盖内置 Skill，实现用户定制。
   *
   * @param searchPaths Skill 搜索路径数组（低 → 高优先级）
   * @returns 最终有效的 SkillDefinition 数组
   */
  scanSkills(searchPaths: string[]): SkillDefinition[] {
    for (const searchDir of searchPaths) {
      try {
        if (!fs.existsSync(searchDir)) continue

        const entries = fs.readdirSync(searchDir, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          if (entry.name.startsWith('.')) continue // 跳过隐藏目录

          const skillPath = path.join(searchDir, entry.name, 'SKILL.md')
          const parsed = parseSkillMd(skillPath)

          if (!parsed) continue

          // 后到覆盖：同名目录从更高优先级的路径中覆盖先前加载的
          const existingName = this.dirNameToSkillName.get(entry.name)
          if (existingName !== undefined) {
            this.skills.delete(existingName) // 移除旧版本
          }
          this.dirNameToSkillName.set(entry.name, parsed.name)

          const skill: SkillDefinition = {
            name: parsed.name,
            description: parsed.description,
            content: parsed.content,
            filePath: skillPath
          }

          this.skills.set(parsed.name, skill)
        }
      } catch (error) {
        log.warn(`[SkillManager] 扫描目录失败: ${searchDir}`, error)
      }
    }

    log.info(
      `[SkillManager] 加载 ${this.skills.size} 个 Skill: ${[...this.skills.keys()].join(', ')}`
    )
    return this.getAll()
  }

  // ========== 动态注册/注销 ==========

  /**
   * 动态注册 Skill（Extension 贡献等场景）
   *
   * 如果同名 Skill 已存在，会被覆盖。
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill)
    log.debug(`[SkillManager] 注册 Skill: ${skill.name}`)
  }

  /**
   * 注销指定 Skill
   *
   * @returns 是否成功注销（不存在则返回 false）
   */
  unregister(name: string): boolean {
    const existed = this.skills.delete(name)
    if (existed) {
      log.debug(`[SkillManager] 注销 Skill: ${name}`)
    }
    return existed
  }

  // ========== 查询 ==========

  /** 获取所有已加载的 Skill */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  /** 按名称查找 Skill */
  getByName(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  /** 已加载的 Skill 数量 */
  get size(): number {
    return this.skills.size
  }

  // ========== 格式化 ==========

  /**
   * 将所有 Skill 格式化为 <skill> XML 块
   *
   * 用于注入到系统提示词的 appendInstructions 中。
   *
   * @returns XML 格式字符串，空则返回空字符串
   */
  toPromptBlocks(): string {
    if (this.skills.size === 0) return ''

    return this.getAll()
      .map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`)
      .join('\n\n')
  }

  // ========== 清理 ==========

  /** 清空所有已加载的 Skill */
  clear(): void {
    this.skills.clear()
    this.dirNameToSkillName.clear()
  }
}
