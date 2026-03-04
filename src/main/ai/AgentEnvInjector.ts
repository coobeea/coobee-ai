/**
 * Agent 环境注入器
 *
 * 在 Builder 构建前注入运行时环境：
 *   1. 获取/创建 Agent 工作空间
 *   2. 扫描并加载 Skill（仅 agent 模式）
 *   3. 注入执行协议 + 运行时路径 + Skill 发现提示 + Agent 发现提示（仅 agent 模式）
 *   4. 设置会话存储目录、工作目录、上下文快照目录
 *
 * 运行模式差异：
 *   - chat: 只设置基础环境（workspace, sessionDir, contextDir），不注入工具/Skill/执行协议
 *   - agent: 完整注入（工具 + Skill + 执行协议 + 运行时路径 + Skill 发现提示）
 *
 * 从 AgentExecutor 中提取，专注于环境准备职责。
 */

import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '@main/common/logger';
import { formatRuntimePaths, buildAgentEnv, type AgentEnv } from './AgentEnv';
import { SkillManager } from './skills';
import { CORE_SKILLS } from './skills/CoreSkills';
import { AgentHomeManager } from './agents/AgentHomeManager';
import { createPathOnlyContext, resolveSandboxContext } from './sandbox';
import type { SandboxMode } from './sandbox';
import type { ToolExecutionContext } from './tools/types';
import type { AgentBuilder } from './AgentExecutor';

const log = createLogger('ai');

/**
 * 注入运行时环境到 Builder
 *
 * @param sessionId - 会话 ID
 * @param builder - Builder 实例
 * @returns workspace 路径（或 undefined）
 */
export async function injectEnv(sessionId: string, builder: AgentBuilder): Promise<string | undefined> {
  try {
    const { Env } = await import('@main/common/env');
    const mode = builder.getMode();

    // 1. 获取/创建工作空间
    // 🆕 检查是否已手动设置 workspace（如子 Agent 手动设置了 workspaceRoot）
    const existingWorkspace = (
      builder as unknown as { getWorkspaceRoot?: () => string | undefined }
    ).getWorkspaceRoot?.();
    const workspace = existingWorkspace || (await Env.getAgentWorkspaceDir(sessionId));

    // 2. 构建 AgentEnv + Agent Home
    const agentEnv = await buildAgentEnv(sessionId, workspace);
    const agentId = (builder as unknown as { getAgentId?: () => string | undefined }).getAgentId?.();

    let agentHome: string | undefined;
    let homeManager: AgentHomeManager | undefined;
    if (agentId) {
      homeManager = new AgentHomeManager(Env.paths.homesDir);
      agentHome = homeManager.initHome(agentId);
      agentEnv.agentId = agentId;
      agentEnv.agentHome = agentHome;
    }

    // ====== Agent 模式独有：Skill + 执行协议 + 运行时路径 ======
    if (mode === 'agent') {
      // 3. 扫描 Skill 并存储到 SkillManager（供 skill_list 工具按需查询）
      //    使用 agentEnv.skillPaths（已包含 Extension 贡献的 Skill 目录）
      //    传入 configDir 以加载 skills.json5 中的 Skill 配置
      const skillManager = new SkillManager();
      skillManager.scanSkills(agentEnv.skillPaths, Env.paths.secretsDir);
      SkillManager.setCurrent(skillManager, sessionId);

      // 4. 注入核心执行协议 + 运行时环境 + Skill 发现提示 + Agent 发现提示到 appendInstructions
      //    执行协议可通过同名 Skill 覆盖（用户在 workspace/skills/execution-protocol/ 创建即可）
      const executionProtocol = buildExecutionProtocol(skillManager);
      const runtimePathsBlock = formatRuntimePaths(agentEnv);
      const skillDiscoveryHint =
        skillManager.size > 0
          ? `<skill_discovery>\n` +
            `You have ${skillManager.size} Skills available. ` +
            `Use the \`skill_list\` tool to discover them.\n\n` +
            `**IMPORTANT**: Before using any Skill, you MUST:\n` +
            `1. Use the \`read\` tool to read its SKILL.md file (path provided by skill_list)\n` +
            `2. Follow the instructions within the SKILL.md file\n` +
            `3. Do NOT attempt to use a Skill without reading its documentation first\n\n` +
            `### Core Skills (ALWAYS ACTIVE — use for every non-trivial task)\n\n` +
            `These are your **mandatory quality assurance** skills:\n\n` +
            `| Skill | Purpose | When to Use |\n` +
            `|-------|---------|-------------|\n` +
            `| **execution-protocol** | 五步工作法：目标提取→计划执行→自我评估→自我修复→报告沉淀 | Every task: decompose goals, write GOAL.md, track progress |\n` +
            `| **self-reflection** | 自我评估与修复方法论：质量评分、过程评分、修复决策树 | After completing any complex task: verify output against criteria |\n` +
            `| **eval-refine-loop** | 维度化评估→差距报告→诊断→优化→再评估的全自动闭环 | When output quality needs systematic verification |\n` +
            `| **brain** | 知识库搜索与经验沉淀 | Before solving: search for existing solutions; After solving: publish reusable knowledge |\n` +
            `| **dimension-architect** | 需求维度量化拆解 | When user requirements need structured dimensional analysis |\n\n` +
            `**CRITICAL WORKFLOW**:\n` +
            `1. **Before execution**: Load \`execution-protocol\` to decompose task and define verifiable criteria\n` +
            `2. **After execution**: Load \`self-reflection\` to evaluate quality against criteria\n` +
            `3. **If quality < 80**: Follow repair strategy in \`self-reflection\`, iterate until passing\n` +
            `4. **For LLM output quality**: Use \`eval-refine-loop\` for systematic dimension-based evaluation\n\n` +
            `### Other Useful Skills\n\n` +
            `- Configuration changes → load "system-config" Skill\n` +
            `- Creating new Skills → load "skill-creator" Skill\n` +
            `- Creating Extensions → load "extension-creator" Skill\n` +
            `- Environment info → load "runtime-env" Skill\n` +
            `\nYou can also use \`config_get\` to view current config and \`config_patch\` to modify it.\n` +
            `</skill_discovery>`
          : '';
      const agentDiscoveryHint = await buildAgentDiscoveryHint();
      const goalBlock = readGoalFile(workspace);
      const agentsMdBlock = await readAgentsMdFiles(Env.paths.agentsMdPath, agentHome, workspace);
      const agentHomeBlock = homeManager && agentId ? homeManager.readInjectableFiles(agentId) : undefined;
      builder.appendInstructions(
        executionProtocol,
        runtimePathsBlock,
        ...(agentsMdBlock ? [agentsMdBlock] : []),
        ...(agentHomeBlock ? [agentHomeBlock] : []),
        ...(goalBlock ? [goalBlock] : []),
        ...(skillDiscoveryHint ? [skillDiscoveryHint] : []),
        ...(agentDiscoveryHint ? [agentDiscoveryHint] : [])
      );

      // 4b. 注入核心技能到 builder（确保子 Agent 也拥有核心技能）
      //     builder.skills() 是累加模式，不会覆盖已有 skills
      const coreSkillDefs = CORE_SKILLS.map((name) => skillManager.getByName(name)).filter(
        (s): s is NonNullable<typeof s> => s !== null
      );
      if (coreSkillDefs.length > 0) {
        builder.skills(coreSkillDefs);
        log.info(
          `[EnvInjector] Injected ${coreSkillDefs.length} core skills: ${coreSkillDefs.map((s) => s.name).join(', ')}`
        );
      }

      // 5. 构建工具执行上下文（由 Runtime 的 convertTools 注入到每个工具）
      //    包含沙箱信息 + Agent/Session 上下文
      const envVars = buildSkillEnvVars(agentEnv);
      const toolCtx = await buildToolExecutionContext(workspace, sessionId, envVars, {
        agentId: agentId || undefined,
        agentName: builder.getName?.() || undefined,
        agentMode: mode
      });
      builder.sandboxContext(toolCtx);
    }

    // ====== Chat & Agent 共享：基础环境设置 ======

    // 6. 设置会话存储目录（指向 .runtime/ 系统空间）
    builder.sessionDir(path.join(workspace, '.runtime', 'sessions'));

    // 7. 设置工作目录（统一 API：两个 Builder 都支持 workspaceRoot()）
    builder.workspaceRoot(workspace);

    // 8. 设置上下文快照目录（.runtime/ 系统空间）
    builder.contextDir(path.join(workspace, '.runtime', 'contexts'));

    log.info(`[EnvInjector] Injected: sessionId=${sessionId}, mode=${mode}, workspace=${workspace}`);
    return workspace;
  } catch (error) {
    log.warn(`[EnvInjector] Failed, continuing without env:`, error);
    return undefined;
  }
}

// ==================== 目标文件读取 ====================

/**
 * 读取工作空间中的 GOAL.md 目标文件
 *
 * 目标文件由 Agent 在执行协议第 1 步（Intent & Goal Extraction）时创建，
 * 存储用户的原始需求和可验证的目标准则。
 *
 * 每次新的请求都会重新读取并注入到 appendInstructions 中，
 * 确保在多轮对话（即使上下文窗口截断）时目标不丢失。
 *
 * @returns `<current_goal>` XML 块，或 undefined（文件不存在时）
 */
function readGoalFile(workspace: string): string | undefined {
  const goalPath = path.join(workspace, 'GOAL.md');
  try {
    const content = fs.readFileSync(goalPath, 'utf-8').trim();
    if (!content) return undefined;

    // 截断过长的目标文件（保护 token 预算）
    const maxLen = 4000;
    const truncated = content.length > maxLen ? content.slice(0, maxLen) + '\n\n... (truncated)' : content;

    return `<current_goal>
The following is the persistent goal for this session, extracted from GOAL.md in the workspace.
Always keep this goal in mind. If the user's new message changes the goal, update GOAL.md accordingly.

${truncated}
</current_goal>`;
  } catch {
    return undefined;
  }
}

// ==================== AGENTS.md 协议文件读取 ====================

/**
 * 读取并合并三级 AGENTS.md 协议文件
 *
 * 优先级（后者可覆盖前者规则）：
 *   1. 全局 AGENTS.md（{userHome}/AGENTS.md）— 系统级规则（所有 Agent 共享）
 *   2. Agent级 AGENTS.md（homes/{agentId}/AGENTS.md）— Agent 自定义规则（跨会话）
 *   3. 会话级 AGENTS.md（{workspace}/AGENTS.md）— 当前会话临时覆盖
 *
 * @param globalPath 全局 AGENTS.md 路径
 * @param agentHome Agent Home 目录路径（可选）
 * @param workspace 工作空间根路径
 * @returns `<system_agents_md>` XML 块，或 undefined
 */
async function readAgentsMdFiles(
  globalPath: string,
  agentHome: string | undefined,
  workspace: string
): Promise<string | undefined> {
  const maxLen = 4000;
  const parts: string[] = [];
  const seenContent = new Set<string>();

  // 1. 全局 AGENTS.md
  try {
    const content = fs.readFileSync(globalPath, 'utf-8').trim();
    if (content) {
      parts.push(content);
      seenContent.add(content);
    }
  } catch {
    // 文件不存在时静默
  }

  // 2. Agent级 AGENTS.md
  const agentMdPath = agentHome ? path.join(agentHome, 'AGENTS.md') : undefined;
  if (agentMdPath) {
    try {
      const content = fs.readFileSync(agentMdPath, 'utf-8').trim();
      if (content && !seenContent.has(content) && !isOnlyComments(content)) {
        parts.push(`---\n\n<!-- Agent-level rules (${agentMdPath}) -->\n\n${content}`);
        seenContent.add(content);
      }
    } catch {
      // 文件不存在时静默
    }
  }

  // 3. 会话级 AGENTS.md
  const wsPath = path.join(workspace, 'AGENTS.md');
  try {
    const content = fs.readFileSync(wsPath, 'utf-8').trim();
    if (content && !seenContent.has(content)) {
      parts.push(`---\n\n<!-- Session-level overrides (${wsPath}) -->\n\n${content}`);
    }
  } catch {
    // 文件不存在时静默
  }

  if (parts.length === 0) return undefined;

  let merged = parts.join('\n\n');
  if (merged.length > maxLen) {
    merged = merged.slice(0, maxLen) + '\n\n... (truncated)';
  }

  const pathLines = [`Global path: ${globalPath}`];
  if (agentMdPath) pathLines.push(`Agent path: ${agentMdPath}`);
  pathLines.push(`Session path: ${wsPath}`);

  return `<system_agents_md>
This is the system-wide AGENTS.md protocol file. It contains identity, rules, and shared context
that ALL agents MUST follow. You may update the workspace-level copy using the \`write\` tool.

${pathLines.join('\n')}

${merged}
</system_agents_md>`;
}

/**
 * 判断内容是否仅包含 Markdown 注释
 */
function isOnlyComments(content: string): boolean {
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
    })
    .join('')
    .trim();
  return stripped.length === 0;
}

// ==================== 核心执行协议 ====================

/**
 * 构建核心执行协议（精简版）
 *
 * 只注入最核心的工作流程原则，详细规范通过 execution-protocol Skill 按需加载。
 *
 * 设计理念：
 *   - appendInstructions 只包含基础规范（减少每次请求的 token 消耗）
 *   - 完整的执行协议、工具选择指南、批处理示例等放在 execution-protocol Skill 中
 *   - Agent 需要时通过 skill_list + read 工具自己加载
 */
function buildExecutionProtocol(_skillManager?: SkillManager): string {
  return `<execution_protocol>
When you receive a user request, follow this protocol:

1. **Intent & Goal Extraction** - Identify core intent and define verifiable criteria
   - **CRITICAL**: For non-trivial tasks, persist the goal by writing a \`GOAL.md\` file in the workspace root:
     \`\`\`
     write({ path: "<workspace>/GOAL.md", content: "# Goal\\n\\n## Original Request\\n...\\n## Objectives\\n...\\n## Verifiable Criteria\\n..." })
     \`\`\`
   - This ensures the goal survives across many conversation turns and context window truncation
   - If GOAL.md already exists (shown in <current_goal> above), review it — update if the user's intent has changed
2. **Plan & Execute** - Create plan and execute step by step
3. **Self-Evaluation (MANDATORY for complex tasks)** - Compare output against criteria (from GOAL.md)
   - **You MUST actually verify** every criterion by running real checks (e.g., execute commands, inspect files, test outputs)
   - Do NOT just claim "completed" — provide evidence for each criterion
   - Load the \`self-reflection\` Skill for the detailed evaluation methodology (quality scoring, process scoring, repair decision tree)
4. **Self-Repair** - Fix issues if evaluation score < 80 (max 3 rounds)
   - Follow the repair priority: fix output → change strategy → re-analyze intent → ask user
5. **Report & Memorize** - Summarize results and save valuable knowledge
   - When task is complete, update GOAL.md status or remove it
   - **IMPORTANT**: Use the \`memory\` tool to persist reusable knowledge:
     · User preferences discovered → \`memory(action='write', file='memory/preferences.md', content='...', append=true)\`
     · Lessons from errors/debugging → \`memory(action='write', file='memory/lessons.md', content='...', append=true)\`
     · Core project knowledge → \`memory(action='write', file='MEMORY.md', content='...', append=true)\`
     · Only save durable, reusable knowledge — NOT session-specific details
   - At the **start** of non-trivial tasks, check existing memory: \`memory(action='list')\` or \`memory(action='search', query='...')\`

## Quality Assurance — NEVER Skip

**Every goal must be verified with real data.** When your task produces outputs (files, code, analysis, etc.):

1. **Test the output** — run commands, check file existence, validate content matches criteria
2. **Score your work** — use the self-reflection methodology (quality × 60% + process × 40%)
3. **Iterate if needed** — if score < 80, repair and re-evaluate before reporting to user
4. **Be honest** — if you cannot verify a criterion, explicitly state it (don't fabricate results)

### Dialectical Verification (for complex tasks)

Self-evaluation has an inherent bias — you wrote the code AND you judge it.
For **complex, high-stakes tasks** (multi-step, multi-file, or mission-critical), use dialectical verification:

1. **Delegate verification to a sub-agent** via \`delegate_to_agent\`:
   - The verifier sub-agent has a fresh context (no implementation bias)
   - Give it the GOAL.md criteria + output location, ask it to independently evaluate
   - The verifier should run real checks, not just review descriptions
2. **Compare results** — if the verifier finds issues you missed, fix them
3. **When to use dialectical verification**:
   - Task involves 3+ files or 100+ lines of changes
   - Task is user-critical (deployment, data migration, security)
   - Your self-evaluation score is borderline (75–85)
   - You are unsure about edge cases

When using multi-agent modes (swarm, orchestrator), the **main agent MUST aggregate and verify** all sub-agent outputs before reporting to the user. Do not blindly trust sub-agent results.

## Brain Knowledge Base Integration

**CRITICAL**: You have the **brain** Skill that allows you to maintain and utilize the shared knowledge base:

- **Before solving a problem** → Use \`brain\` Skill's search scripts to check if a solution already exists
- **After solving a problem** → Use \`brain\` Skill's publish scripts to save the solution for future reuse
- **When encountering errors** → Search by error signals (e.g., TimeoutError, ConnectionRefused)
- **When discovering patterns** → Publish patterns to help future agents avoid the same mistakes

This is **fundamental to system optimization** — building collective intelligence through experience sharing.

For detailed guidelines (batch execution, tool selection, exploration strategies), load the **execution-protocol** Skill via \`skill_list\` → \`read\`.

NOTE: For simple/trivial requests (greetings, quick facts, single-step tasks), skip steps 1 and 3-5 — just answer directly.
</execution_protocol>`;
}

// ==================== Agent 发现提示 ====================

/**
 * 构建 Agent 发现提示块
 *
 * 从 AgentStore 加载已注册 Agent 列表，生成 <agent_discovery> 提示：
 *   - 已注册 Agent 的 ID / 名称 / 描述
 *   - 三种多 Agent 协作模式的使用指引
 *   - 模式选择决策指南
 *
 * 如果 AgentStore 不可用或为空，返回 undefined（不注入）。
 */
async function buildAgentDiscoveryHint(): Promise<string | undefined> {
  try {
    const { AgentStore } = await import('./agents/AgentStore');
    const store = await AgentStore.getInstance();
    const agents = await store.list();

    const agentList =
      agents.length > 0
        ? agents.map((a) => `- **${a.name}** (\`${a.id}\`): ${a.description}`).join('\n')
        : '_No registered agents yet. New agents are created via the AI Creator or HTTP API._';

    return `<agent_discovery>
## Registered Agents

${agentList}

## Multi-Agent Collaboration

You can collaborate with other agents using \`delegate_to_agent\`:
- You maintain control; the sub-agent runs like a tool call
- Best for: specific, well-defined sub-tasks
- Usage: pick an agent from the list above → delegate_to_agent(agentId, task)

### Decision Guide

- Simple sub-task → delegate_to_agent(agentId, task)
- Need a new specialist? → Describe the need; the system's AI Creator handles agent creation
- Agent definitions are managed via the HTTP REST API (/gateway/agents/*)

### Agent Lifecycle

- Registered agents are listed above; use \`delegate_to_agent\` to invoke them
- New agents are created through the AI Creator service or HTTP API, not via tools
- Temporary agents in Orchestrator/Swarm are session-scoped and auto-destroyed
</agent_discovery>`;
  } catch (error) {
    log.warn('[EnvInjector] Failed to build agent discovery hint:', error);
    return undefined;
  }
}

// ==================== Skill 上下文环境变量 ====================

/**
 * 构建注入子进程的 COOBEE_* 环境变量
 *
 * Skill 脚本通过这些变量获取运行时上下文：
 *   - COOBEE_CONFIG_DIR     — 配置目录（读取 skills.json5 等）
 *   - COOBEE_WORKSPACE      — 工作空间目录
 *   - COOBEE_SESSION_ID     — 当前会话 ID
 *   - COOBEE_USER_HOME      — 应用主目录
 *   - COOBEE_MEMORY_DIR     — 记忆目录
 */
function buildSkillEnvVars(env: AgentEnv): Record<string, string> {
  return {
    COOBEE_CONFIG_DIR: env.configDir,
    COOBEE_WORKSPACE: env.workspace,
    COOBEE_SESSION_ID: env.sessionId,
    COOBEE_USER_HOME: env.userHome,
    COOBEE_MEMORY_DIR: env.memoryDir
  };
}

// ==================== 工具执行上下文构建 ====================

/** Agent 上下文信息（由调用方传入） */
interface AgentContextInfo {
  agentId?: string;
  agentName?: string;
  agentType?: import('./threads/types').AgentType;
  agentMode?: import('./runtime/types').AgentMode;
  parentSessionId?: string;
}

/**
 * 构建工具执行上下文（ToolExecutionContext）
 *
 * 在沙箱上下文基础上，注入 Agent/Session/Thread 维度 + 工作空间路径 + 系统路径。
 * 工具执行函数通过此上下文获取完整的运行环境，无需自行 path.join 或动态 import Env。
 *
 * 沙箱模式从 ConfigStore 读取 security.sandbox.mode：
 *   - 'off': 无沙箱保护
 *   - 'path-only': 路径守卫（默认）
 *   - 'docker': Docker 容器隔离
 */
async function buildToolExecutionContext(
  workspace: string,
  sessionId: string,
  envVars: Record<string, string>,
  agentInfo?: AgentContextInfo
): Promise<ToolExecutionContext> {
  let sandboxMode: SandboxMode = 'path-only';

  try {
    const { configStoreInstance } = await import('@main/common/config/ConfigStore');
    if (configStoreInstance) {
      const security = configStoreInstance.get('security');
      const configMode = security?.sandbox?.mode;
      if (configMode) {
        sandboxMode = configMode;
        log.info(`[EnvInjector] Sandbox mode from config: ${sandboxMode}`);
      }
    }
  } catch {
    // ConfigStore 不可用时使用默认值
  }

  // 构建基础沙箱上下文
  let baseCtx;
  if (sandboxMode === 'off') {
    baseCtx = {
      mode: 'off' as const,
      workspaceRoot: workspace,
      toolPolicy: { allow: [] as string[], deny: [] as string[] },
      sessionId,
      envVars
    };
  } else if (sandboxMode === 'docker') {
    baseCtx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: workspace }, sessionId);
    baseCtx.envVars = envVars;
  } else {
    baseCtx = createPathOnlyContext(workspace, { sessionId, envVars });
  }

  // 系统路径（从 Env 读取，失败时用合理默认值）
  let userHome = '';
  let configDir = '';
  let memoryDir = '';
  let tempDir = '';
  try {
    const { Env } = await import('@main/common/env');
    userHome = Env.paths.userHome;
    configDir = Env.paths.configDir;
    memoryDir = Env.paths.memoryDir;
    tempDir = Env.paths.temp;
  } catch {
    const os = await import('node:os');
    userHome = path.join(os.homedir(), '.coobee-ai');
    configDir = path.join(userHome, 'config');
    memoryDir = path.join(userHome, 'memory');
    tempDir = os.tmpdir();
  }

  // threadId：顶层 sessionId 即为 threadId，子 Agent 的 sessionId 含 `:` 分隔符
  const threadId = sessionId.includes(':') ? sessionId.split(':')[0] : sessionId;

  // cwd：Docker 模式用容器内工作目录，否则用 workspaceRoot
  const cwd = baseCtx.docker?.workdir || workspace;

  const toolCtx: ToolExecutionContext = {
    // 沙箱基础
    ...baseCtx,
    sessionId,

    // 会话标识
    threadId,

    // 工作目录
    cwd,

    // 用户空间
    outputDir: path.join(workspace, 'user', 'output'),
    userDir: path.join(workspace, 'user'),
    tasksDir: path.join(workspace, 'tasks'),

    // 系统空间（.runtime/）
    sessionsDir: path.join(workspace, '.runtime', 'sessions'),
    contextsDir: path.join(workspace, '.runtime', 'contexts'),
    eventsDir: path.join(workspace, '.runtime', 'events'),

    // 系统路径
    userHome,
    configDir,
    memoryDir,
    tempDir,

    // Agent 信息（必填）
    agentName: agentInfo?.agentName || 'agent',
    agentMode: agentInfo?.agentMode || 'agent',

    // Agent 信息（可选）
    agentId: agentInfo?.agentId,
    agentType: agentInfo?.agentType,
    parentSessionId: agentInfo?.parentSessionId
  };

  return toolCtx;
}
