/**
 * Agent 环境注入器
 *
 * 在 Builder 构建前注入运行时环境：
 *   1. 获取/创建 Agent 工作空间
 *   2. 扫描并加载 Skill（仅 agent 模式）
 *   3. 注入执行协议 + 运行时路径 + Skill 发现提示（仅 agent 模式）
 *   4. 设置会话存储目录、工作目录、上下文快照目录
 *
 * 运行模式差异：
 *   - chat: 只设置基础环境（workspace, sessionDir, contextDir），不注入工具/Skill/执行协议
 *   - agent: 完整注入（工具 + Skill + 执行协议 + 运行时路径 + Skill 发现提示）
 *
 * 从 AgentExecutor 中提取，专注于环境准备职责。
 */

import path from 'node:path'
import { createLogger } from '@main/common/logger'
import { formatRuntimePaths, buildAgentEnv } from './AgentEnv'
import { SkillManager } from './skills'
import { createPathOnlyContext } from './sandbox'
import type { AgentBuilder } from './AgentExecutor'

const log = createLogger('ai')

/**
 * 注入运行时环境到 Builder
 *
 * @param sessionId - 会话 ID
 * @param builder - Builder 实例
 * @returns workspace 路径（或 undefined）
 */
export async function injectEnv(
  sessionId: string,
  builder: AgentBuilder
): Promise<string | undefined> {
  try {
    const { Env } = await import('@main/common/env')
    const mode = builder.getMode()

    // 1. 获取/创建工作空间
    const workspace = await Env.getAgentWorkspaceDir(sessionId)

    // 2. 构建 AgentEnv
    const agentEnv = await buildAgentEnv(sessionId, workspace)

    // ====== Agent 模式独有：Skill + 执行协议 + 运行时路径 ======
    if (mode === 'agent') {
      // 3. 扫描 Skill 并存储到 SkillManager（供 skill_list 工具按需查询）
      //    使用 agentEnv.skillPaths（已包含 Extension 贡献的 Skill 目录）
      const skillManager = new SkillManager()
      skillManager.scanSkills(agentEnv.skillPaths)
      SkillManager.setCurrent(skillManager)

      // 4. 注入核心执行协议 + 运行时环境 + Skill 发现提示到 appendInstructions
      //    执行协议可通过同名 Skill 覆盖（用户在 workspace/skills/execution-protocol/ 创建即可）
      const executionProtocol = buildExecutionProtocol(skillManager)
      const runtimePathsBlock = formatRuntimePaths(agentEnv)
      const skillDiscoveryHint =
        skillManager.size > 0
          ? `<skill_discovery>\n` +
            `You have ${skillManager.size} Skills available. ` +
            `Use the \`skill_list\` tool to discover them. ` +
            `When you find a relevant Skill, use the \`read\` tool to read its SKILL.md file, ` +
            `then follow the instructions within.\n` +
            `</skill_discovery>`
          : ''
      builder.appendInstructions(
        executionProtocol,
        runtimePathsBlock,
        ...(skillDiscoveryHint ? [skillDiscoveryHint] : [])
      )

      // 5. 设置沙箱上下文（由 Runtime 的 convertTools 使用）
      const sandboxCtx = createPathOnlyContext(workspace, { sessionId })
      builder.sandboxContext(sandboxCtx)
    }

    // ====== Chat & Agent 共享：基础环境设置 ======

    // 6. 设置会话存储目录（指向 workspace 内的 sessions/）
    builder.sessionDir(path.join(workspace, 'sessions'))

    // 7. 设置工作目录（统一 API：两个 Builder 都支持 workspaceRoot()）
    builder.workspaceRoot(workspace)

    // 8. 设置上下文快照目录（Runtime 层写入）
    builder.contextDir(path.join(workspace, 'contexts'))

    log.info(`[EnvInjector] Injected: sessionId=${sessionId}, mode=${mode}, workspace=${workspace}`)
    return workspace
  } catch (error) {
    log.warn(`[EnvInjector] Failed, continuing without env:`, error)
    return undefined
  }
}

// ==================== 核心执行协议 ====================

/**
 * 构建核心执行协议
 *
 * 定义 Agent 的默认行为循环：
 *   意图识别 → 目标量化 → 执行 → 自我评估 → 自我修复
 *
 * 这是 Agent 的基础行为规范，通过 appendInstructions 注入到所有 Agent。
 * 详细的评估方法论由 self-reflection Skill 提供（按需加载）。
 *
 * **可覆盖**：用户可在工作空间的 skills/execution-protocol/ 下创建同名 SKILL.md 覆盖。
 * SkillManager 的"后到覆盖"策略确保工作空间版本优先于内置版本。
 */
function buildExecutionProtocol(skillManager?: SkillManager): string {
  // 优先使用 SkillManager 中的 execution-protocol Skill（支持用户/Agent 覆盖）
  const customProtocol = skillManager?.getByName('execution-protocol')
  if (customProtocol?.content) {
    return `<execution_protocol>\n${customProtocol.content}\n</execution_protocol>`
  }

  // 兜底：硬编码默认值（正常情况下不会走到这里，因为内置 Skill 应该总是可用的）
  return `<execution_protocol>
When you receive a user request, follow this protocol:

1. **Intent & Goal Extraction**
   - Identify the user's core intent and underlying need
   - Extract concrete goals from the request
   - For each goal, define verifiable criteria:
     · Quantifiable goals → specific metrics (numbers, pass/fail, existence checks)
     · Fuzzy/creative goals → acceptance checklist (qualities, properties to verify)
   - Keep the criteria lightweight — 2-5 items per goal is sufficient

2. **Plan & Execute**
   - Create a brief plan to achieve the goals
   - Execute step by step, using available tools
   - Track progress against your verifiable criteria

3. **Self-Evaluation** (after task completion)
   - **Quality**: Compare your output against the verifiable criteria from step 1
   - **Process**: Briefly reflect on execution efficiency — any unnecessary steps, errors, or waste?
   - For detailed evaluation, load the \`self-reflection\` Skill (via \`skill_list\` → \`read\`)
   - Use \`session_history\` / \`context_inspect\` tools for objective process data when needed

4. **Self-Repair** (if evaluation reveals issues, max 3 rounds)
   - Fix priority (try in order):
     a. Fix execution strategy — try a different approach to achieve the goal
     b. Fix goal understanding — re-analyze user intent if criteria seem wrong
     c. Report remaining issues to user with clear explanation
   - **Stop condition**: all criteria pass, OR score doesn't improve after 2 consecutive rounds

5. **Report & Memorize**
   - Summarize what was accomplished vs. original goals
   - Note any unresolved issues or caveats
   - **Save valuable knowledge to memory** (only if durable and reusable):
     · User preferences discovered → \`memory(write, scope='agent', file='memory/preferences.md')\`
     · Lessons learned from errors → \`memory(write, scope='agent', file='memory/lessons.md')\`
     · Core project knowledge → \`memory(write, scope='agent', file='MEMORY.md')\`
     · Use \`append=true\` to add to existing memory files
   - Do NOT save session-specific details — only knowledge that helps in future sessions

NOTE: For simple/trivial requests (greetings, quick facts, single-step tasks), skip steps 1 and 3-5 — just answer directly.
</execution_protocol>`
}
