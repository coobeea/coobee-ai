/**
 * Agent 运行时环境 — 安全子集
 *
 * 从全局 Env 中提取 Agent 可见的路径和配置，
 * 不暴露数据库、端口、密钥等敏感信息。
 *
 * 用途：
 *   1. 注入到系统提示词（appendInstructions）的 <runtime_paths> 块
 *   2. 作为 Agent 进程的环境变量子集（未来 sandbox 场景）
 */

import fs from 'fs'
import path from 'path'
import { log } from '@main/common/logger'
import type { SkillDefinition } from '../runtime/types'

// ==================== 类型定义 ====================

/**
 * Agent 可见的运行时环境
 */
export interface AgentEnv {
  /** 工作空间根目录 */
  workspace: string
  /** 用户主目录 */
  userHome: string
  /** 系统临时目录 */
  temp: string
  /** 操作系统 */
  platform: 'darwin' | 'win32' | 'linux'
  /** 是否为开发模式 */
  isDev: boolean
  /** Skill 搜索路径（按优先级从低到高） */
  skillPaths: string[]
  /** 内置 Skill 目录 */
  builtinSkillsDir: string
  /** 用户 Skill 目录 */
  userSkillsDir: string
  /** 记忆总根目录 */
  memoryDir: string
  /** Extension 搜索路径（按优先级从低到高） */
  extensionPaths: string[]
}

// ==================== 构建函数 ====================

/**
 * 从全局 Env 构建 Agent 安全环境子集
 *
 * @param workspace Agent 工作空间路径（由 Env.getAgentWorkspaceDir 返回）
 */
export async function buildAgentEnv(workspace: string): Promise<AgentEnv> {
  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env')

  const skillPaths = await Env.getSkillSearchPaths(workspace)
  const extensionPaths = await Env.getExtensionSearchPaths(workspace)

  return {
    workspace,
    userHome: Env.paths.userHome,
    temp: Env.paths.temp,
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    isDev: Env.isDev,
    skillPaths,
    builtinSkillsDir: Env.paths.builtinSkillsDir,
    userSkillsDir: Env.paths.userSkillsDir,
    memoryDir: Env.paths.memoryDir,
    extensionPaths
  }
}

// ==================== 提示词注入 ====================

/**
 * 将 AgentEnv 格式化为 <runtime_paths> XML 块
 *
 * 注入到 appendInstructions 中，让 LLM 了解可用路径。
 */
export function formatRuntimePaths(env: AgentEnv): string {
  return `<runtime_paths>
<workspace>${env.workspace}</workspace>
<userHome>${env.userHome}</userHome>
<temp>${env.temp}</temp>
<builtinSkillsDir>${env.builtinSkillsDir}</builtinSkillsDir>
<userSkillsDir>${env.userSkillsDir}</userSkillsDir>
<memoryDir>${env.memoryDir}</memoryDir>
<platform>${env.platform}</platform>
<isDev>${env.isDev}</isDev>
<skillPaths>
${env.skillPaths.map((p) => `  <path>${p}</path>`).join('\n')}
</skillPaths>
</runtime_paths>`
}

// ==================== Skill 加载 ====================

/**
 * 加载内置 runtime-env Skill
 *
 * 从 builtinSkillsDir/runtime-env/SKILL.md 读取。
 * 如果文件不存在则返回 null（不阻断执行）。
 */
export async function loadRuntimeEnvSkill(
  builtinSkillsDir: string
): Promise<SkillDefinition | null> {
  const skillPath = path.join(builtinSkillsDir, 'runtime-env', 'SKILL.md')

  try {
    if (!fs.existsSync(skillPath)) {
      log.warn(`[AgentEnv] runtime-env Skill 不存在: ${skillPath}`)
      return null
    }

    const content = fs.readFileSync(skillPath, 'utf-8')

    // 解析 frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    const body = fmMatch ? fmMatch[2].trim() : content.trim()

    return {
      name: 'runtime-env',
      description: 'Agent 运行时环境的目录结构、路径约定和可用资源说明',
      content: body
    }
  } catch (error) {
    log.error(`[AgentEnv] 加载 runtime-env Skill 失败:`, error)
    return null
  }
}
