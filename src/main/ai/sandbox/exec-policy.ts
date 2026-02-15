/**
 * exec 命令安全策略
 *
 * 提供命令级安全过滤，防止 LLM 执行危险命令。
 *
 * 三层防护：
 *   1. 危险命令黑名单（始终拒绝，不可覆盖）
 *   2. 安全命令白名单（始终允许，不触发 HITL）
 *   3. 动态 allowlist 学习（approve-always 时记住命令模式）
 *
 * 集成架构（策略与 HITL 审批层协同）：
 *
 *   OpenAI Runtime 路径（有 HITL）：
 *     LLM 调用 exec → SDK needsApproval 触发中断
 *     → AgentExecutor.computePolicyDecisions() 自动决策
 *     → 白名单命令自动放行（approve-once），黑名单自动拒绝（reject）
 *     → 未知命令交给用户通过前端 HITL 审批
 *     → approve-always 时 learnExecCommand() 学习到动态 allowlist
 *
 *   PiMono Runtime 路径（无 HITL）：
 *     LLM 调用 exec → convertTools 执行包装器中检查 checkExecPolicy()
 *     → 黑名单命令直接拒绝（无 HITL 回退）
 *     → 白名单 & 未知命令放行（PiMono 信任工具策略 + 路径守卫）
 *
 *   两条路径的 Runtime execute 回调中都有黑名单兜底检查（纵深防御）。
 *
 * 注意：策略不在 exec 工具内部，工具层是纯执行逻辑。
 *
 * @module sandbox/exec-policy
 */

import { log } from '@main/common/logger'

// ==================== 类型定义 ====================

/** 策略检查结果 */
export type PolicyDecision =
  | { action: 'allow'; reason: string }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string }

// ==================== 安全白名单 ====================

/**
 * 安全命令前缀（不触发 HITL，直接放行）
 *
 * 只包含只读或极低风险的命令。
 * 注意：这里匹配的是命令的首个 token（二进制名称）。
 */
const SAFE_BINS: ReadonlySet<string> = new Set([
  // 文件系统（只读）
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'find',
  'tree',
  'du',
  'df',
  'realpath',
  'readlink',
  'basename',
  'dirname',

  // 搜索
  'grep',
  'rg',
  'ag',
  'awk',
  'sed', // sed 可以修改文件，但通常在管道中使用
  'sort',
  'uniq',
  'diff',
  'comm',
  'cut',
  'tr',
  'jq',

  // 系统信息
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'uptime',
  'env',
  'printenv',
  'echo',
  'printf',
  'which',
  'where',
  'type',
  'id',

  // 开发工具（只读操作）
  'git',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'go',
  'rustc',
  'javac',
  'java',
  'mvn',
  'gradle',

  // 网络（只读）
  'ping',
  'dig',
  'nslookup',
  'host',

  // 文本处理
  'less',
  'more',
  'bat', // bat (better cat)
  'hexdump',
  'xxd',
  'md5',
  'shasum',
  'sha256sum',

  // 其他安全工具
  'true',
  'false',
  'test',
  'expr',
  'bc',
  'tee',
  'xargs'
])

// ==================== 危险命令黑名单 ====================

/**
 * 危险命令模式（始终拒绝）
 *
 * 使用正则匹配，覆盖常见的危险操作。
 * 即使用户 approve-always 也不能跳过这些检查。
 */
const DANGER_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // 破坏性文件操作
  {
    pattern: /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)/i,
    reason: 'recursive/force remove'
  },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i, reason: 'rm -rf detected' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i, reason: 'rm -fr detected' },
  { pattern: /\bmkfs\b/i, reason: 'filesystem format' },
  { pattern: /\bdd\s+.*of=/i, reason: 'raw disk write (dd)' },
  { pattern: /\bformat\b.*[/\\]/i, reason: 'disk format' },

  // 权限提升
  { pattern: /\bsudo\b/i, reason: 'privilege escalation (sudo)' },
  { pattern: /\bsu\s+-?\s*$/i, reason: 'switch user (su)' },
  { pattern: /\bchmod\s+[0-7]*777/i, reason: 'world-writable permissions' },
  { pattern: /\bchown\b/i, reason: 'change file ownership' },

  // 远程代码执行
  { pattern: /\bcurl\b.*\|\s*(sh|bash|zsh|python)/i, reason: 'pipe remote code to shell' },
  { pattern: /\bwget\b.*\|\s*(sh|bash|zsh|python)/i, reason: 'pipe remote code to shell' },
  { pattern: /\beval\b/i, reason: 'eval command' },

  // 系统破坏
  { pattern: /\bshutdown\b/i, reason: 'system shutdown' },
  { pattern: /\breboot\b/i, reason: 'system reboot' },
  { pattern: /\bhalt\b/i, reason: 'system halt' },
  { pattern: /\binit\s+0/i, reason: 'system halt via init' },
  { pattern: /\bkillall\b/i, reason: 'kill all processes' },
  { pattern: /\bpkill\s+-9/i, reason: 'force kill by name' },

  // Fork 炸弹
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i, reason: 'fork bomb' },

  // 敏感文件访问
  { pattern: /\/etc\/shadow/i, reason: 'access /etc/shadow' },
  { pattern: /\/etc\/sudoers/i, reason: 'access /etc/sudoers' }
]

// ==================== Allowlist 学习 ====================

/**
 * 动态 allowlist — 从 approve-always 中学习的命令模式
 *
 * 存储的是命令前缀模式（二进制名称），而非完整命令。
 * 内存中维护，应用重启后清空（后续可持久化到配置文件）。
 */
const learnedAllowlist = new Set<string>()

// ==================== 公共 API ====================

/**
 * 检查命令是否允许执行
 *
 * @param command - 要执行的 shell 命令
 * @returns 策略决策（allow / deny / ask）
 */
export function checkExecPolicy(command: string): PolicyDecision {
  const trimmed = command.trim()

  // 1. 黑名单检查（不可覆盖）
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        action: 'deny',
        reason: `Dangerous command blocked: ${reason}`
      }
    }
  }

  // 2. 提取首个命令 token（处理管道、重定向等）
  const bin = extractCommandBin(trimmed)

  // 3. 安全白名单
  if (bin && SAFE_BINS.has(bin)) {
    return {
      action: 'allow',
      reason: `Safe command: ${bin}`
    }
  }

  // 4. 动态 allowlist
  if (bin && learnedAllowlist.has(bin)) {
    return {
      action: 'allow',
      reason: `Learned allowlist: ${bin}`
    }
  }

  // 5. 未知命令 → 需要审批
  return {
    action: 'ask',
    reason: `Unknown command: ${bin || trimmed.slice(0, 50)}`
  }
}

/**
 * 将命令模式加入动态 allowlist（approve-always 时调用）
 */
export function learnExecCommand(command: string): void {
  const bin = extractCommandBin(command.trim())
  if (bin && !SAFE_BINS.has(bin)) {
    learnedAllowlist.add(bin)
    log.info(`[ExecPolicy] Learned allowlist: ${bin}`)
  }
}

/**
 * 获取当前动态 allowlist 内容（用于调试/显示）
 */
export function getLearnedAllowlist(): string[] {
  return Array.from(learnedAllowlist)
}

/**
 * 清空动态 allowlist
 */
export function clearLearnedAllowlist(): void {
  learnedAllowlist.clear()
}

// ==================== 内部 ====================

/**
 * 从命令字符串中提取首个可执行文件名
 *
 * 处理常见前缀模式：
 *   - `cd dir && npm install` → `cd`
 *   - `FOO=bar npm run build` → `npm`
 *   - `./script.sh` → `script.sh`
 *   - `/usr/bin/python3 foo.py` → `python3`
 */
function extractCommandBin(command: string): string | null {
  // 跳过环境变量赋值 (VAR=val ...)
  let trimmed = command
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(trimmed)) {
    trimmed = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
  }

  // 提取第一个 token
  const match = trimmed.match(/^(?:\.\/)?([^\s|;&]+)/)
  if (!match) return null

  let bin = match[1]

  // 去除路径前缀（`/usr/bin/python3` → `python3`）
  const lastSlash = bin.lastIndexOf('/')
  if (lastSlash >= 0) {
    bin = bin.slice(lastSlash + 1)
  }

  return bin || null
}
