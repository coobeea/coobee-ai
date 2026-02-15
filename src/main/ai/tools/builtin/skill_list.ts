/**
 * skill_list — 按需发现可用 Skill
 *
 * 列出所有已加载的 Skill（名称、描述、SKILL.md 文件路径）。
 * Agent 通过此工具发现可用 Skill，然后使用 read 工具读取 SKILL.md 获取详细指令。
 *
 * 工作流：
 *   1. Agent 调用 skill_list 查看有哪些 Skill
 *   2. Agent 决定使用某个 Skill
 *   3. Agent 调用 read 工具读取该 Skill 的 SKILL.md 文件
 *   4. Agent 按 SKILL.md 中的指示操作
 *
 * 分类：Discovery | 风险：低（只读）
 */

import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'
import { SkillManager } from '../../skills'

export const skillListTool: ToolDefinition = {
  name: 'skill_list',
  description:
    'List all available Skills with name, description, and file path. ' +
    'Skills are specialized knowledge/instructions you can load on-demand. ' +
    'After finding a useful Skill, use the `read` tool to read its SKILL.md file, ' +
    'then follow the instructions within.',
  category: ToolCategory.Discovery,
  needUserConfirm: false,
  parameters: z.object({}),

  execute: async function* (
    _params: Record<string, unknown>
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    yield { type: 'progress' as const, content: '[skill_list] listing...' }

    const manager = SkillManager.getCurrent()

    if (!manager || manager.size === 0) {
      return { success: true, llmContent: 'No Skills available.' }
    }

    const skills = manager.getAll()

    const lines: string[] = [`Available Skills (${skills.length}):`, '']

    for (const skill of skills) {
      lines.push(`- **${skill.name}**`)
      if (skill.description) {
        lines.push(`  ${skill.description}`)
      }
      if (skill.filePath) {
        lines.push(`  Path: ${skill.filePath}`)
      }
      lines.push('')
    }

    lines.push(
      'To use a Skill, read its SKILL.md file with the `read` tool, then follow its instructions.'
    )

    return { success: true, llmContent: lines.join('\n') }
  }
}
