/**
 * 工具策略
 *
 * 控制哪些工具可以被 Agent 调用。
 * 支持精确匹配和 glob 模式（`*` 通配符）。
 *
 * 执行逻辑（deny 优先）：
 *   1. 工具名命中 deny 列表 → 拒绝
 *   2. allow 非空且工具名未命中 allow 列表 → 拒绝
 *   3. 以上都不满足 → 允许
 *
 * 参考 OpenClaw 的 tool-policy.ts，简化了 source tracking。
 */
import type { SandboxToolPolicy, ResolvedToolPolicy } from './types'

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
 * @param policy - 原始配置
 * @returns 已解析的策略
 */
export function resolveToolPolicy(policy?: SandboxToolPolicy): ResolvedToolPolicy {
  return {
    allow: policy?.allow ?? [],
    deny: policy?.deny ?? []
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
