/**
 * 配置 Diff 算法 + 热重载计划生成
 *
 * 递归比较两个配置对象，返回变更路径列表，
 * 然后根据预定义的重载规则生成 ReloadPlan。
 */
import type { ReloadKind, ReloadPlan, ReloadRule } from './types'

/** 默认热重载规则 */
export const DEFAULT_RELOAD_RULES: ReloadRule[] = [
  // hot 规则 — 立即通知
  { prefix: 'ui.theme', kind: 'hot' },
  { prefix: 'ui.language', kind: 'hot' },
  { prefix: 'ui.soundEffects', kind: 'hot' },
  { prefix: 'logging.level', kind: 'hot' },
  { prefix: 'logging.file', kind: 'hot' },

  // none 规则 — 下次使用时自动取新值
  { prefix: 'models', kind: 'none' },
  { prefix: 'agents', kind: 'none' },
  { prefix: 'tools', kind: 'none' },
  { prefix: 'messages', kind: 'none' },
  { prefix: 'security', kind: 'none' }
]

/**
 * 递归 diff 两个对象，返回变更的路径列表
 *
 * @param prev 旧配置
 * @param next 新配置
 * @param prefix 当前路径前缀
 * @returns 变更的路径列表（如 ["ui.theme", "models.providers.openai.apiKey"]）
 */
export function diffConfigPaths(prev: unknown, next: unknown, prefix = ''): string[] {
  const changes: string[] = []

  // 类型不同 → 整个路径变更
  if (typeof prev !== typeof next) {
    changes.push(prefix || '.')
    return changes
  }

  // 都是 null/undefined
  if (prev === null || prev === undefined) {
    if (next !== null && next !== undefined) {
      changes.push(prefix || '.')
    }
    return changes
  }
  if (next === null || next === undefined) {
    changes.push(prefix || '.')
    return changes
  }

  // 原始值比较
  if (typeof prev !== 'object') {
    if (prev !== next) {
      changes.push(prefix || '.')
    }
    return changes
  }

  // 数组比较（简化：JSON 序列化比较）
  if (Array.isArray(prev) || Array.isArray(next)) {
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      changes.push(prefix || '.')
    }
    return changes
  }

  // 对象递归比较
  const prevObj = prev as Record<string, unknown>
  const nextObj = next as Record<string, unknown>
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)])

  for (const key of allKeys) {
    const childPath = prefix ? `${prefix}.${key}` : key
    const childChanges = diffConfigPaths(prevObj[key], nextObj[key], childPath)
    changes.push(...childChanges)
  }

  return changes
}

/**
 * 根据变更路径和规则生成热重载计划
 */
export function buildReloadPlan(
  changedPaths: string[],
  rules: ReloadRule[] = DEFAULT_RELOAD_RULES
): ReloadPlan {
  const hotPaths: string[] = []
  const nonePaths: string[] = []

  for (const path of changedPaths) {
    const kind = matchRule(path, rules)
    if (kind === 'hot') {
      hotPaths.push(path)
    } else {
      nonePaths.push(path)
    }
  }

  return { changedPaths, hotPaths, nonePaths }
}

/**
 * 匹配变更路径到最佳规则
 *
 * 最长前缀匹配：更具体的规则优先。
 */
function matchRule(path: string, rules: ReloadRule[]): ReloadKind {
  let bestKind: ReloadKind = 'none'
  let bestLen = -1

  for (const rule of rules) {
    if (path === rule.prefix || path.startsWith(rule.prefix + '.')) {
      if (rule.prefix.length > bestLen) {
        bestLen = rule.prefix.length
        bestKind = rule.kind
      }
    }
  }

  return bestKind
}
