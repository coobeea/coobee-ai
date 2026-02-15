/**
 * 工具策略
 *
 * 控制哪些工具可以被 Agent 调用，以及哪些需要用户确认。
 * 支持精确匹配、glob 模式（`*` 通配符）和工具组（`group:` 前缀）。
 *
 * 工具组定义：
 *   - group:fs      → read, write, edit
 *   - group:exec    → exec, process
 *   - group:memory  → memory
 *   - group:observe → session_status, session_history, context_inspect, skill_list
 *
 * 执行逻辑（deny 优先）：
 *   1. 工具名命中 deny 列表 → 拒绝
 *   2. allow 非空且工具名未命中 allow 列表 → 拒绝
 *   3. 以上都不满足 → 允许
 *
 * 确认逻辑（独立于 allow/deny）：
 *   4. 工具名命中 confirm 列表 → 需要用户确认
 *   5. 未命中 → 使用工具自身的 needUserConfirm
 *
 * 策略分层（高优先级覆盖低优先级）：
 *   Agent 策略 → 全局策略 → 默认策略
 *   deny 始终叠加（安全优先），allow 取交集
 *
 * 参考 OpenClaw 的 tool-policy.ts。
 */
import type { SandboxToolPolicy, ResolvedToolPolicy } from './types'

// ========== 工具组定义 ==========

/**
 * 工具组 → 工具名映射
 *
 * 策略配置中使用 `group:fs` 等语法引用整组工具。
 * 新增内置工具时应同步更新此映射。
 */
export const TOOL_GROUPS: Record<string, string[]> = {
  fs: ['read', 'write', 'edit'],
  exec: ['exec', 'process'],
  memory: ['memory'],
  observe: ['session_status', 'session_history', 'context_inspect', 'skill_list']
}

/**
 * 展开策略列表中的 group: 引用
 *
 * @example
 * expandGroups(['group:fs', 'exec']) → ['read', 'write', 'edit', 'exec']
 */
export function expandGroups(patterns: string[]): string[] {
  const result: string[] = []
  for (const p of patterns) {
    if (p.startsWith('group:')) {
      const groupName = p.slice(6)
      const members = TOOL_GROUPS[groupName]
      if (members) {
        result.push(...members)
      } else {
        // 未知 group，保留原样（可能是用户自定义 group，后续可扩展）
        result.push(p)
      }
    } else {
      result.push(p)
    }
  }
  return result
}

// ========== 模式编译 ==========

type CompiledPattern =
  | { kind: 'all' }
  | { kind: 'exact'; value: string }
  | { kind: 'regex'; value: RegExp }

/**
 * 编译单个 glob 模式为可执行的匹配器
 *
 * 支持：
 *   - `*` — 匹配全部
 *   - `file_*` — 前缀通配
 *   - `*_search` — 后缀通配
 *   - `read` — 精确匹配
 */
function compilePattern(pattern: string): CompiledPattern {
  const normalized = pattern.trim().toLowerCase()
  if (!normalized) {
    return { kind: 'exact', value: '' }
  }
  if (normalized === '*') {
    return { kind: 'all' }
  }
  if (!normalized.includes('*')) {
    return { kind: 'exact', value: normalized }
  }
  // 转义正则特殊字符，然后把 \* 替换为 .*
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    kind: 'regex',
    value: new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`)
  }
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return []
  }
  return patterns.map(compilePattern).filter((p) => p.kind !== 'exact' || p.value !== '')
}

function matchesAny(name: string, patterns: CompiledPattern[]): boolean {
  for (const pattern of patterns) {
    if (pattern.kind === 'all') return true
    if (pattern.kind === 'exact' && name === pattern.value) return true
    if (pattern.kind === 'regex' && pattern.value.test(name)) return true
  }
  return false
}

// ========== 公开 API ==========

/**
 * 检查工具是否被策略允许
 *
 * @param toolName - 工具名
 * @param policy   - 工具策略配置
 * @returns true = 允许, false = 拒绝
 *
 * @example
 * isToolAllowed('exec', { deny: ['exec'] })  // false
 * isToolAllowed('read', { allow: ['read', 'write'] })  // true
 * isToolAllowed('exec', { allow: ['read', 'write'] })  // false
 * isToolAllowed('read', {})  // true (无策略 = 全部允许)
 */
export function isToolAllowed(
  toolName: string,
  policy?: SandboxToolPolicy | ResolvedToolPolicy
): boolean {
  if (!policy) return true

  const normalized = toolName.trim().toLowerCase()

  // deny 优先
  const denyPatterns = compilePatterns(policy.deny)
  if (matchesAny(normalized, denyPatterns)) {
    return false
  }

  // allow 校验
  const allowPatterns = compilePatterns(policy.allow)
  if (allowPatterns.length === 0) {
    return true // 空 allow = 全部允许
  }
  return matchesAny(normalized, allowPatterns)
}

/**
 * 解析工具策略配置为运行时格式
 *
 * 自动展开 `group:` 引用。
 *
 * @param policy - 原始配置
 * @returns 已解析的策略
 */
export function resolveToolPolicy(policy?: SandboxToolPolicy): ResolvedToolPolicy {
  return {
    allow: expandGroups(policy?.allow ?? []),
    deny: expandGroups(policy?.deny ?? []),
    confirm: expandGroups(policy?.confirm ?? [])
  }
}

/**
 * 检查工具是否需要用户确认
 *
 * @param toolName - 工具名
 * @param policy   - 已解析的策略
 * @returns true = 策略要求确认（覆盖工具自身的 needUserConfirm）
 */
export function needsConfirmation(
  toolName: string,
  policy?: SandboxToolPolicy | ResolvedToolPolicy
): boolean | undefined {
  if (!policy || !policy.confirm || policy.confirm.length === 0) return undefined
  const normalized = toolName.trim().toLowerCase()
  const confirmPatterns = compilePatterns(
    Array.isArray(policy.confirm) ? expandGroups(policy.confirm) : policy.confirm
  )
  return matchesAny(normalized, confirmPatterns) ? true : undefined
}

/**
 * 合并多层策略（高优先级 → 低优先级）
 *
 * deny 叠加（安全优先），allow 取交集，confirm 叠加。
 * 传入顺序：[最高优先级, ..., 最低优先级]
 */
export function mergeToolPolicies(
  ...policies: (SandboxToolPolicy | undefined)[]
): SandboxToolPolicy {
  const deny: string[] = []
  const confirm: string[] = []
  let allow: string[] | undefined

  for (const policy of policies) {
    if (!policy) continue

    // deny 始终叠加
    if (policy.deny?.length) {
      deny.push(...policy.deny)
    }

    // confirm 始终叠加
    if (policy.confirm?.length) {
      confirm.push(...policy.confirm)
    }

    // allow 取交集（仅当有明确 allow 列表时）
    if (policy.allow?.length) {
      if (allow === undefined) {
        allow = [...policy.allow]
      } else {
        // 交集：只保留两边都允许的
        const expanded = new Set(expandGroups(policy.allow))
        allow = allow.filter((a) => {
          const names = a.startsWith('group:') ? TOOL_GROUPS[a.slice(6)] || [a] : [a]
          return names.some((n) => expanded.has(n))
        })
      }
    }
  }

  return {
    ...(allow !== undefined ? { allow } : {}),
    ...(deny.length > 0 ? { deny: [...new Set(deny)] } : {}),
    ...(confirm.length > 0 ? { confirm: [...new Set(confirm)] } : {})
  }
}

/**
 * 生成工具被拦截时的错误消息
 *
 * @param toolName - 被拦截的工具名
 * @param policy   - 策略配置
 * @returns 人类可读的拦截原因
 */
export function formatToolBlockedMessage(toolName: string, policy: ResolvedToolPolicy): string {
  const normalized = toolName.trim().toLowerCase()
  const denyPatterns = compilePatterns(policy.deny)
  const allowPatterns = compilePatterns(policy.allow)

  const blockedByDeny = matchesAny(normalized, denyPatterns)
  const blockedByAllow = allowPatterns.length > 0 && !matchesAny(normalized, allowPatterns)

  const reasons: string[] = []
  if (blockedByDeny) {
    reasons.push(`denied by pattern in deny list`)
  }
  if (blockedByAllow) {
    reasons.push(`not in allow list`)
  }

  return `Tool "${toolName}" blocked by sandbox policy: ${reasons.join(', ')}.`
}
