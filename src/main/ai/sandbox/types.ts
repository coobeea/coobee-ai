/**
 * 沙箱系统核心类型
 *
 * 沙箱是一个通用安全基础设施，不依赖具体的工具实现。
 * 内置工具和扩展工具都受沙箱管辖。
 *
 * 三层防护模型：
 *   1. 路径守卫（path-guard）— 文件操作的目录边界
 *   2. 工具策略（tool-policy）— 工具级别的 allow/deny 过滤
 *   3. Docker 沙箱（docker）— 命令在隔离容器中执行（可选）
 */

// ========== 沙箱模式 ==========

/**
 * 沙箱运行模式
 *
 * - off       — 无沙箱保护（开发/调试用）
 * - path-only — 仅启用路径守卫 + 工具策略（默认，轻量）
 * - docker    — 路径守卫 + 工具策略 + Docker 容器隔离（完整保护）
 */
export type SandboxMode = 'off' | 'path-only' | 'docker'

// ========== 工具策略 ==========

/**
 * 工具策略配置
 *
 * 控制哪些工具可以被 Agent 调用，以及哪些需要用户确认。
 * 支持 glob 模式匹配和工具组引用。
 *
 * 工具组前缀 `group:`：
 *   - group:fs      → read, write, edit
 *   - group:exec    → exec, process
 *   - group:memory  → memory
 *   - group:observe → session_status, session_history, context_inspect, skill_list
 *
 * 执行逻辑：
 *   1. deny 优先：命中 deny 列表 → 拒绝
 *   2. allow 校验：allow 非空且未命中 → 拒绝
 *   3. confirm 校验：命中 confirm 列表 → 需要用户确认
 *   4. 默认允许：都没命中 → 允许（无需确认）
 */
export interface SandboxToolPolicy {
  /** 允许的工具列表（glob / group: 模式，空数组 = 允许全部） */
  allow?: string[]
  /** 拒绝的工具列表（glob / group: 模式，优先于 allow） */
  deny?: string[]
  /** 需要用户确认的工具列表（glob / group: 模式） */
  confirm?: string[]
}

// ========== Docker 配置 ==========

/**
 * Docker 沙箱配置（精简版）
 *
 * 参考 OpenClaw 的 SandboxDockerConfig，但去掉了我们暂不需要的：
 * - seccomp/apparmor profile
 * - ulimits
 * - extraHosts / dns
 * - binds（V1 只挂载 workspace）
 */
export interface SandboxDockerConfig {
  /** Docker 镜像名（默认 debian:bookworm-slim） */
  image: string
  /** 容器名前缀（默认 coobee-sbx-） */
  containerPrefix: string
  /** 容器内工作目录（默认 /workspace） */
  workdir: string
  /** 是否只读根文件系统（默认 true） */
  readOnlyRoot: boolean
  /** tmpfs 挂载（默认 ['/tmp', '/var/tmp']） */
  tmpfs: string[]
  /** 网络模式（默认 none — 完全隔离） */
  network: 'none' | 'bridge' | 'host'
  /** 丢弃的 Linux capabilities（默认 ['ALL']） */
  capDrop: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 容器创建后执行的初始化命令 */
  setupCommand?: string
  /** 内存限制（如 '256m'） */
  memory?: string
  /** CPU 限制（如 1.0） */
  cpus?: number
}

// ========== 沙箱配置 ==========

/**
 * 沙箱完整配置
 *
 * 由 AgentExecutor 或用户配置生成，传入 sandbox context 构建器。
 */
export interface SandboxConfig {
  /** 沙箱模式 */
  mode: SandboxMode
  /** 工作区根目录（路径守卫的基准） */
  workspaceRoot: string
  /**
   * 沙箱根目录（可选，比 workspaceRoot 更严格）
   *
   * 用于限制 Agent 只能操作工作区的某个子目录。
   * 未设置时以 workspaceRoot 为边界。
   */
  sandboxRoot?: string
  /** 工具策略 */
  toolPolicy?: SandboxToolPolicy
  /** Docker 配置（mode='docker' 时必须） */
  docker?: SandboxDockerConfig
}

// ========== 沙箱上下文（运行时） ==========

/**
 * Docker 容器运行时信息
 */
export interface SandboxDockerInfo {
  /** 容器名 */
  containerName: string
  /** 容器内工作目录 */
  workdir: string
  /** 是否正在运行 */
  running: boolean
}

/**
 * 沙箱运行时上下文
 *
 * 由 resolveSandboxContext() 构建，注入到工具执行和 Runtime 层。
 * 这是工具和 Runtime 实际使用的接口。
 */
export interface SandboxContext {
  /** 沙箱模式 */
  mode: SandboxMode
  /** 工作区根目录 */
  workspaceRoot: string
  /** 沙箱根目录（路径守卫使用） */
  sandboxRoot?: string
  /** 已解析的工具策略 */
  toolPolicy: ResolvedToolPolicy
  /** Docker 容器信息（mode='docker' 时存在） */
  docker?: SandboxDockerInfo
  /** 会话标识 */
  sessionId?: string
  /**
   * 注入到子进程的环境变量
   *
   * Skill 脚本通过这些变量获取运行时上下文（配置目录、工作空间等）。
   * exec 工具在 spawn 子进程时会将这些变量合并到 process.env 中。
   */
  envVars?: Record<string, string>
}

/**
 * 已解析的工具策略（含编译后的匹配器）
 */
export interface ResolvedToolPolicy {
  /** 原始配置 */
  allow: string[]
  deny: string[]
  /** 需要用户确认的工具列表（已展开 group:，可选，默认空） */
  confirm?: string[]
}

// ========== 默认配置 ==========

/** 默认 Docker 配置 */
export const DEFAULT_DOCKER_CONFIG: SandboxDockerConfig = {
  image: 'debian:bookworm-slim',
  containerPrefix: 'coobee-sbx-',
  workdir: '/workspace',
  readOnlyRoot: true,
  tmpfs: ['/tmp', '/var/tmp'],
  network: 'none',
  capDrop: ['ALL'],
  env: { LANG: 'C.UTF-8' }
}

/** 默认沙箱配置（path-only 模式） */
export const DEFAULT_SANDBOX_CONFIG: Omit<SandboxConfig, 'workspaceRoot'> = {
  mode: 'path-only',
  toolPolicy: {
    allow: [],
    deny: [],
    confirm: []
  }
}
