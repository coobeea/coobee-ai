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
import { createLogger } from '@main/common/logger';
import { formatRuntimePaths, buildAgentEnv, type AgentEnv } from './AgentEnv';
import { SkillManager } from './skills';
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

    // 2. 构建 AgentEnv
    const agentEnv = await buildAgentEnv(sessionId, workspace);

    // ====== Agent 模式独有：Skill + 执行协议 + 运行时路径 ======
    if (mode === 'agent') {
      // 3. 扫描 Skill 并存储到 SkillManager（供 skill_list 工具按需查询）
      //    使用 agentEnv.skillPaths（已包含 Extension 贡献的 Skill 目录）
      //    传入 configDir 以加载 skills.json5 中的 Skill 配置
      const skillManager = new SkillManager();
      skillManager.scanSkills(agentEnv.skillPaths, Env.paths.configDir);
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
            `Key Skills for self-management:\n` +
            `- Configuration changes → load "system-config" Skill\n` +
            `- Creating new Skills → load "skill-creator" Skill\n` +
            `- Creating Extensions → load "extension-creator" Skill\n` +
            `- Self-evaluation → load "self-reflection" Skill\n` +
            `- Environment info → load "runtime-env" Skill\n` +
            `\nYou can also use \`config_get\` to view current config and \`config_patch\` to modify it.\n` +
            `</skill_discovery>`
          : '';
      const agentDiscoveryHint = await buildAgentDiscoveryHint();
      builder.appendInstructions(
        executionProtocol,
        runtimePathsBlock,
        ...(skillDiscoveryHint ? [skillDiscoveryHint] : []),
        ...(agentDiscoveryHint ? [agentDiscoveryHint] : [])
      );

      // 5. 构建工具执行上下文（由 Runtime 的 convertTools 注入到每个工具）
      //    包含沙箱信息 + Agent/Session 上下文
      const envVars = buildSkillEnvVars(agentEnv);
      const toolCtx = await buildToolExecutionContext(workspace, sessionId, envVars, {
        agentName: builder.getName?.() || undefined,
        agentMode: mode
      });
      builder.sandboxContext(toolCtx);
    }

    // ====== Chat & Agent 共享：基础环境设置 ======

    // 6. 设置会话存储目录（指向 workspace 内的 sessions/）
    builder.sessionDir(path.join(workspace, 'sessions'));

    // 7. 设置工作目录（统一 API：两个 Builder 都支持 workspaceRoot()）
    builder.workspaceRoot(workspace);

    // 8. 设置上下文快照目录（Runtime 层写入）
    builder.contextDir(path.join(workspace, 'contexts'));

    log.info(`[EnvInjector] Injected: sessionId=${sessionId}, mode=${mode}, workspace=${workspace}`);
    return workspace;
  } catch (error) {
    log.warn(`[EnvInjector] Failed, continuing without env:`, error);
    return undefined;
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
  const customProtocol = skillManager?.getByName('execution-protocol');
  if (customProtocol?.content) {
    return `<execution_protocol>\n${customProtocol.content}\n</execution_protocol>`;
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
        : '_No registered agents yet. Use `manage_agent(create)` to create one._';

    return `<agent_discovery>
## Registered Agents

${agentList}

## Multi-Agent Modes

You have three ways to collaborate with other agents:

1. **Tool Delegation** (\`delegate_to_agent\`)
   - You maintain control; sub-agent is like a tool call
   - Best for: specific, well-defined sub-tasks
   - Usage: manage_agent(list) → delegate_to_agent(agentId, task)

2. **Orchestrator** (programmatic plan → parallel workers)
   - A Planner decomposes the task, then workers execute in stages
   - Best for: complex tasks that can be pre-decomposed
   - Currently available as OrchestratorRuntime (not yet exposed as tool)

3. **Swarm** (dynamic handoff between specialist agents)
   - Triage routes to specialists; agents hand off to each other
   - Best for: exploratory tasks where the path is unclear
   - Currently available as SwarmRuntime (not yet exposed as tool)

### Decision Guide

- Simple sub-task → delegate_to_agent
- Complex, decomposable task → Orchestrator (future)
- Exploratory, uncertain task → Swarm (future)
- Need a new specialist? → manage_agent(create) first, then delegate

### Agent Lifecycle

- Use \`manage_agent(list)\` to discover registered agents
- Use \`manage_agent(create)\` to create reusable specialists
- Use \`manage_agent(get, id)\` to read an agent's full definition
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

    // 工作空间子目录
    sessionsDir: path.join(workspace, 'sessions'),
    contextsDir: path.join(workspace, 'contexts'),
    eventsDir: path.join(workspace, 'events'),
    tasksDir: path.join(workspace, 'tasks'),
    outputDir: path.join(workspace, 'output'),

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
