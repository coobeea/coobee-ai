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

// ==================== 类型定义 ====================

/**
 * Agent 可见的运行时环境
 *
 * 让 AI 全面了解自身所处的环境，包括：
 *   - 系统信息（平台、架构、版本）
 *   - 目录结构（工作空间、Skill、Extension、记忆）
 *   - 能力清单（可用工具、已加载扩展）
 */
export interface AgentEnv {
  // --- 系统信息 ---
  /** 操作系统 */
  platform: 'darwin' | 'win32' | 'linux'
  /** CPU 架构 */
  arch: string
  /** 是否为开发模式 */
  isDev: boolean
  /** 应用版本 */
  appVersion: string

  // --- 工作空间 ---
  /** 工作空间根目录 */
  workspace: string
  /** 当前会话 ID */
  sessionId: string

  // --- 系统路径 ---
  /** 用户主目录（应用级，如 ~/.coobee-ai） */
  userHome: string
  /** 系统用户主目录（如 /Users/xxx） */
  systemHome: string
  /** 系统临时目录 */
  temp: string
  /** 配置目录（存放 coobee.json5、secrets.json5、skills.json5） */
  configDir: string

  // --- Skill 系统 ---
  /** Skill 搜索路径（按优先级从低到高） */
  skillPaths: string[]
  /** 内置 Skill 目录 */
  builtinSkillsDir: string
  /** 用户 Skill 目录 */
  userSkillsDir: string

  // --- Extension 系统 ---
  /** Extension 搜索路径（按优先级从低到高） */
  extensionPaths: string[]
  /** 内置 Extension 目录 */
  builtinExtensionsDir: string
  /** 用户 Extension 目录 */
  userExtensionsDir: string
  /** 已加载的 Extension ID 列表 */
  loadedExtensions: string[]

  // --- 记忆系统 ---
  /** 记忆总根目录 */
  memoryDir: string

  // --- 能力清单 ---
  /** 可用工具名称列表 */
  availableTools: string[]

  // --- 安全上下文 ---
  /** 沙箱模式 */
  sandboxMode: 'off' | 'path-only' | 'docker'
  /** 命令审批策略 */
  execApproval: 'auto' | 'always' | 'never'

  // --- 模型上下文 ---
  /** 当前默认模型（provider/model 格式） */
  defaultModel: string
  /** 思维链级别 */
  thinkingLevel: string
}

// ==================== 构建函数 ====================

/**
 * 从全局 Env 构建 Agent 安全环境子集
 *
 * @param sessionId 会话 ID
 * @param workspace Agent 工作空间路径（由 Env.getAgentWorkspaceDir 返回）
 */
export async function buildAgentEnv(sessionId: string, workspace: string): Promise<AgentEnv> {
  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env')

  const skillPaths = await Env.getSkillSearchPaths(workspace)
  const extensionPaths = await Env.getExtensionSearchPaths(workspace)

  // Extension 系统信息
  let loadedExtensions: string[] = []
  let availableTools: string[] = []

  try {
    const { ExtensionManager } = await import('@main/common/extension')
    const registry = ExtensionManager.getRegistry()
    if (registry) {
      // 合并扩展贡献的 Skill 目录
      // 优先级：内置(1) → 扩展贡献(1.5) → 用户级(2) → 工作空间(3)
      const extSkillDirs = registry.getSkillDirs().map((s) => s.dir)
      if (extSkillDirs.length > 0) {
        const builtinIdx = skillPaths.indexOf(Env.paths.builtinSkillsDir)
        const insertIdx = builtinIdx >= 0 ? builtinIdx + 1 : 0
        skillPaths.splice(insertIdx, 0, ...extSkillDirs)
      }

      // 已加载的 Extension ID 列表
      loadedExtensions = registry.getExtensionIds()
    }
  } catch {
    // Extension 系统未初始化时忽略
  }

  // 可用工具清单
  try {
    const { ToolRegistry } = await import('@main/ai/tools/registry')
    const toolReg = ToolRegistry.getInstance()
    availableTools = toolReg.getAll().map((t) => t.name)
  } catch {
    // ToolRegistry 未初始化时忽略
  }

  // 安全与模型上下文
  let sandboxMode: 'off' | 'path-only' | 'docker' = 'path-only'
  let execApproval: 'auto' | 'always' | 'never' = 'auto'
  let defaultModel = 'unknown'
  let thinkingLevel = 'medium'

  try {
    const { configStoreInstance } = await import('@main/common/config/ConfigStore')
    if (configStoreInstance) {
      const security = configStoreInstance.get('security')
      sandboxMode = security?.sandbox?.mode ?? 'path-only'
      execApproval = security?.approvals?.exec ?? 'auto'

      const agents = configStoreInstance.get('agents')
      defaultModel = agents?.defaults?.model?.primary ?? 'unknown'
      thinkingLevel = agents?.defaults?.thinkingLevel ?? 'medium'
    }
  } catch {
    // ConfigStore 未初始化时使用默认值
  }

  return {
    // 系统信息
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    arch: process.arch,
    isDev: Env.isDev,
    appVersion: Env.app?.version ?? '0.0.0',

    // 工作空间
    workspace,
    sessionId,

    // 系统路径
    userHome: Env.paths.userHome,
    systemHome: Env.paths.home,
    temp: Env.paths.temp,
    configDir: Env.paths.configDir,

    // Skill 系统
    skillPaths,
    builtinSkillsDir: Env.paths.builtinSkillsDir,
    userSkillsDir: Env.paths.userSkillsDir,

    // Extension 系统
    extensionPaths,
    builtinExtensionsDir: Env.paths.builtinExtensionsDir,
    userExtensionsDir: Env.paths.userExtensionsDir,
    loadedExtensions,

    // 记忆系统
    memoryDir: Env.paths.memoryDir,

    // 能力清单
    availableTools,

    // 安全上下文
    sandboxMode,
    execApproval,

    // 模型上下文
    defaultModel,
    thinkingLevel
  }
}

// ==================== 提示词注入 ====================

/**
 * 将 AgentEnv 格式化为 <runtime_paths> XML 块
 *
 * 注入到 appendInstructions 中，让 LLM 了解可用路径。
 */
export function formatRuntimePaths(env: AgentEnv): string {
  return `<runtime_environment>
<system>
  <platform>${env.platform}</platform>
  <arch>${env.arch}</arch>
  <appVersion>${env.appVersion}</appVersion>
  <isDev>${env.isDev}</isDev>
</system>
<session>
  <sessionId>${env.sessionId}</sessionId>
  <workspace>${env.workspace}</workspace>
</session>
<paths>
  <userHome>${env.userHome}</userHome>
  <systemHome>${env.systemHome}</systemHome>
  <configDir>${env.configDir}</configDir>
  <temp>${env.temp}</temp>
  <memoryDir>${env.memoryDir}</memoryDir>
</paths>
<skills>
  <builtinSkillsDir>${env.builtinSkillsDir}</builtinSkillsDir>
  <userSkillsDir>${env.userSkillsDir}</userSkillsDir>
  <searchPaths>
${env.skillPaths.map((p) => `    <path>${p}</path>`).join('\n')}
  </searchPaths>
</skills>
<extensions>
  <builtinExtensionsDir>${env.builtinExtensionsDir}</builtinExtensionsDir>
  <userExtensionsDir>${env.userExtensionsDir}</userExtensionsDir>
  <searchPaths>
${env.extensionPaths.map((p) => `    <path>${p}</path>`).join('\n')}
  </searchPaths>
  <loaded>
${env.loadedExtensions.map((id) => `    <extension>${id}</extension>`).join('\n')}
  </loaded>
</extensions>
<security>
  <sandboxMode>${env.sandboxMode}</sandboxMode>
  <execApproval>${env.execApproval}</execApproval>
</security>
<model>
  <default>${env.defaultModel}</default>
  <thinkingLevel>${env.thinkingLevel}</thinkingLevel>
</model>
<tools>
${env.availableTools.map((t) => `  <tool>${t}</tool>`).join('\n')}
</tools>
</runtime_environment>`
}
