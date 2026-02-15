/**
 * 配置环境变量替换
 *
 * 支持 ${VAR_NAME} 模板语法，从 process.env 中解析值。
 * 未找到的变量保留原始模板字符串。
 */

/** ${VAR_NAME} 匹配正则 */
const ENV_TEMPLATE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g

/**
 * 递归替换对象中所有字符串值的 ${VAR} 模板
 *
 * @param obj 待处理的配置对象（JSON5 解析结果）
 * @param env 环境变量源（默认 process.env）
 * @returns 替换后的新对象（不修改原对象）
 */
export function resolveEnvVars<T>(
  obj: T,
  env: Record<string, string | undefined> = process.env
): T {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    return replaceEnvTemplate(obj, env) as unknown as T
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item, env)) as unknown as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value, env)
    }
    return result as T
  }

  return obj
}

/**
 * 替换单个字符串中的 ${VAR} 模板
 */
function replaceEnvTemplate(str: string, env: Record<string, string | undefined>): string {
  return str.replace(ENV_TEMPLATE_RE, (_match, varName: string) => {
    const value = env[varName]
    return value !== undefined ? value : _match // 未找到时保留原模板
  })
}
