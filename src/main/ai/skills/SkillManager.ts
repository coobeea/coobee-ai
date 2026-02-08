/**
 * 技能管理器
 * 管理和执行技能（基于 @openai/agents SDK）
 */

import type { AISkill, SkillActivationOptions, SkillExecutionContext } from './types'

/**
 * 技能激活结果
 */
export interface SkillActivationResult {
  /** 激活的技能列表 */
  activatedSkills: AISkill[]
  /** 技能提示词段落（注入到 Agent instructions） */
  promptSection: string
}

/**
 * 技能管理器接口
 */
export interface ISkillManager {
  register(skill: AISkill): void
  registerAll(skills: AISkill[]): void
  getAllSkills(): AISkill[]
  getSkill(skillId: string): AISkill | undefined
  activateSkills(context: string, options?: SkillActivationOptions): SkillActivationResult
  executeSkill(skillId: string, context: SkillExecutionContext): Promise<unknown>
  generatePromptSection(skills: AISkill[]): string
}

/**
 * 技能管理器实现
 */
export class SkillManager implements ISkillManager {
  private skills = new Map<string, AISkill>()

  register(skill: AISkill): void {
    this.skills.set(skill.id, skill)
  }

  registerAll(skills: AISkill[]): void {
    skills.forEach((skill) => this.register(skill))
  }

  getAllSkills(): AISkill[] {
    return Array.from(this.skills.values())
  }

  getSkill(skillId: string): AISkill | undefined {
    return this.skills.get(skillId)
  }

  activateSkills(context: string, _options?: SkillActivationOptions): SkillActivationResult {
    const allSkills = this.getAllSkills()
    const activatedSkills: AISkill[] = []

    // 简单的关键词匹配
    for (const skill of allSkills) {
      if (this.isSkillRelevant(skill, context)) {
        activatedSkills.push(skill)
      }
    }

    const promptSection = this.generatePromptSection(activatedSkills)

    return {
      activatedSkills,
      promptSection
    }
  }

  async executeSkill(skillId: string, context: SkillExecutionContext): Promise<unknown> {
    const skill = this.getSkill(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    return await skill.execute(context)
  }

  generatePromptSection(skills: AISkill[]): string {
    if (skills.length === 0) {
      return ''
    }

    let section = '\n\n## Available Skills\n\n'
    section += 'The following skills have been activated for you:\n\n'

    for (const skill of skills) {
      section += `### ${skill.name}\n`
      section += `- **ID**: ${skill.id}\n`
      section += `- **Description**: ${skill.description}\n`

      if (skill.keywords && skill.keywords.length > 0) {
        section += `- **Keywords**: ${skill.keywords.join(', ')}\n`
      }

      if (skill.examples && skill.examples.length > 0) {
        section += '- **Examples**:\n'
        skill.examples.forEach((example, idx) => {
          section += `  ${idx + 1}. ${example}\n`
        })
      }

      section += '\n'
    }

    return section
  }

  private isSkillRelevant(skill: AISkill, context: string): boolean {
    const contextLower = context.toLowerCase()

    if (skill.keywords && skill.keywords.length > 0) {
      for (const keyword of skill.keywords) {
        if (contextLower.includes(keyword.toLowerCase())) {
          return true
        }
      }
    }

    if (
      contextLower.includes(skill.name.toLowerCase()) ||
      contextLower.includes(skill.description.toLowerCase())
    ) {
      return true
    }

    return false
  }
}
