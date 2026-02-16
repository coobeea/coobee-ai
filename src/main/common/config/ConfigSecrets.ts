/**
 * API Key 密钥管理
 *
 * 从独立的 secrets.json5 文件加载 API Key，
 * 合并到 provider 配置中，避免在大配置文件里翻找。
 *
 * secrets.json5 格式极简：
 * {
 *   dashscope: "sk-xxx",
 *   silicon: "sk-xxx",
 * }
 */
import fs from 'fs'
import JSON5 from 'json5'
import path from 'path'

/** 密钥文件名 */
const SECRETS_FILE_NAME = 'secrets.json5'

/** provider id → api key */
export type SecretsMap = Record<string, string>

/**
 * 读取 secrets.json5
 *
 * @returns 解析后的 key-value map，文件不存在或格式错误时返回空对象
 */
export function loadSecrets(configDir: string): SecretsMap {
  const filePath = path.join(configDir, SECRETS_FILE_NAME)

  if (!fs.existsSync(filePath)) return {}

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON5.parse(raw)

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    // 只保留 string 类型的值
    const result: SecretsMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 将 secrets 合并到已解析的配置对象中
 *
 * 规则：secrets 中的 apiKey 覆盖 provider 中的 apiKey
 * （仅当 secrets 中有值且非空时才覆盖）
 */
export function mergeSecrets<T>(config: T, secrets: SecretsMap): T {
  if (!config || typeof config !== 'object') return config
  if (Object.keys(secrets).length === 0) return config

  // 深拷贝，避免修改原始对象
  const cloned = structuredClone(config)

  const obj = cloned as Record<string, unknown>
  const providers = (obj.models as Record<string, unknown>)?.providers as
    | Record<string, Record<string, unknown>>
    | undefined

  if (!providers) return config

  for (const [providerId, apiKey] of Object.entries(secrets)) {
    if (providers[providerId]) {
      providers[providerId].apiKey = apiKey
    }
  }

  return cloned
}

/** secrets.json5 文件路径 */
export function secretsPath(configDir: string): string {
  return path.join(configDir, SECRETS_FILE_NAME)
}

/** 确保 secrets.json5 存在，不存在则创建模板 */
export function ensureSecretsFile(configDir: string): void {
  const filePath = secretsPath(configDir)
  if (fs.existsSync(filePath)) return

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const template = `// Coobee AI — API Key 配置
// 在这里填写各供应商的 API Key，保存后自动生效
// 格式：供应商ID: "你的Key"
{
  dashscope: "",
  silicon: "",
  deepseek: "",
  // 按需添加更多供应商...
  // zhipu: "",
  // minimax: "",
  // moonshot: "",
  // doubao: "",
}
`
  fs.writeFileSync(filePath, template, 'utf-8')
}
