/**
 * API Key 解析器
 *
 * 解析优先级（高 → 低）：
 * 1. Provider 配置中的 apiKey（含 ${VAR} 模板替换）
 * 2. 环境变量（基于 Provider ID 推断变量名）
 *
 * 支持 ${ENV_VAR} 模板语法。
 */

/** ${VAR_NAME} 匹配正则 */
const ENV_TEMPLATE_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)}$/

/** 常见 Provider ID → 环境变量名映射 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  aliyun: 'DASHSCOPE_API_KEY',
  minimax: 'MINIMAX_API_KEY'
}

/**
 * 解析 API Key
 *
 * @param apiKey Provider 配置中的 apiKey 字段
 * @param providerId Provider ID（用于推断环境变量名）
 * @param env 环境变量源（默认 process.env）
 * @returns 解析后的 API Key，未找到时返回 undefined
 */
export function resolveApiKey(
  apiKey: string | undefined,
  providerId: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  // 1. 如果有配置值，尝试解析模板
  if (apiKey) {
    const match = apiKey.match(ENV_TEMPLATE_RE)
    if (match) {
      // 是 ${VAR} 模板
      const envValue = env[match[1]]
      if (envValue) return envValue
      // 模板未解析成功，继续尝试其他来源
    } else {
      // 不是模板，直接使用
      return apiKey
    }
  }

  // 2. 按 Provider ID 查找已知环境变量
  const knownEnvVar = PROVIDER_ENV_MAP[providerId.toLowerCase()]
  if (knownEnvVar) {
    const envValue = env[knownEnvVar]
    if (envValue) return envValue
  }

  // 3. 尝试通用格式 {PROVIDER_ID}_API_KEY
  const genericEnvVar = `${providerId.toUpperCase()}_API_KEY`
  const genericValue = env[genericEnvVar]
  if (genericValue) return genericValue

  // 未找到
  return undefined
}
