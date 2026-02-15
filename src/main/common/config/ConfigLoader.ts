/**
 * 配置加载器
 *
 * 加载管线（简化版 10 步）：
 * 1. 解析配置文件路径
 * 2. 读取文件内容
 * 3. JSON5 解析
 * 4. ${VAR} 环境变量替换
 * 5. Zod schema 校验
 * 6. 默认值填充
 * 7. 缓存结果
 */
import crypto from 'crypto'
import fs from 'fs'
import JSON5 from 'json5'
import path from 'path'

import { resolveEnvVars } from './ConfigEnv'
import { mergeWithDefaults } from './ConfigDefaults'
import type { CoobeeConfig } from './schema'
import { CoobeeConfigSchema } from './schema'
import type { ConfigSnapshot, ConfigValidationIssue } from './types'

/** 默认配置文件名 */
const CONFIG_FILE_NAME = 'coobee.json5'

export class ConfigLoader {
  private configDir: string
  private cached: ConfigSnapshot | null = null

  /**
   * @param configDir 配置目录路径（如 ~/.coobee-ai）
   */
  constructor(configDir: string) {
    this.configDir = configDir
  }

  /** 配置文件绝对路径 */
  get configPath(): string {
    return path.join(this.configDir, CONFIG_FILE_NAME)
  }

  /**
   * 加载配置（带缓存）
   *
   * 首次调用读取文件并解析；后续调用返回缓存。
   * 使用 clearCache() 清除缓存以强制重新加载。
   */
  load(): CoobeeConfig {
    if (this.cached) {
      return this.cached.config
    }
    const snap = this.snapshot()
    this.cached = snap
    return snap.config
  }

  /**
   * 直接读取文件快照（不使用缓存）
   */
  snapshot(): ConfigSnapshot {
    const filePath = this.configPath
    const exists = fs.existsSync(filePath)

    if (!exists) {
      return this.buildEmptySnapshot(filePath)
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const hash = crypto.createHash('md5').update(raw).digest('hex')

    // Step 3: JSON5 解析
    let parsed: unknown
    try {
      parsed = JSON5.parse(raw)
    } catch (err) {
      return this.buildErrorSnapshot(filePath, raw, hash, [
        { path: '', message: `JSON5 parse error: ${(err as Error).message}` }
      ])
    }

    // Step 4: 环境变量替换
    const envResolved = resolveEnvVars(parsed)

    // Step 5: Zod 校验
    const result = CoobeeConfigSchema.safeParse(envResolved)

    if (!result.success) {
      const issues: ConfigValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
      return this.buildErrorSnapshot(filePath, raw, hash, issues)
    }

    // Step 6: 默认值填充
    const config = mergeWithDefaults(result.data)

    return {
      path: filePath,
      exists: true,
      raw,
      config,
      valid: true,
      issues: [],
      hash
    }
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cached = null
  }

  /** 确保配置目录和文件存在 */
  ensureConfigFile(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true })
    }
    if (!fs.existsSync(this.configPath)) {
      const defaultContent = `// Coobee AI 配置文件
// 详细文档: https://github.com/coobee-ai/coobee-ai
{
  // 模型与 Provider 配置
  // models: {
  //   providers: {
  //     openai: {
  //       baseUrl: "https://api.openai.com/v1",
  //       apiKey: "\${OPENAI_API_KEY}",
  //       api: "openai-compatible",
  //       models: [
  //         { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxTokens: 16384 }
  //       ]
  //     }
  //   }
  // },

  // UI 偏好
  ui: {
    theme: "auto",
    language: "zh-CN",
    soundEffects: true
  },

  // 日志
  logging: {
    level: "info",
    file: true
  }
}
`
      fs.writeFileSync(this.configPath, defaultContent, 'utf-8')
    }
  }

  // ─── 私有方法 ─────────────────────────────────────

  private buildEmptySnapshot(filePath: string): ConfigSnapshot {
    return {
      path: filePath,
      exists: false,
      raw: null,
      config: mergeWithDefaults({}),
      valid: true,
      issues: [],
      hash: null
    }
  }

  private buildErrorSnapshot(
    filePath: string,
    raw: string,
    hash: string,
    issues: ConfigValidationIssue[]
  ): ConfigSnapshot {
    return {
      path: filePath,
      exists: true,
      raw,
      config: mergeWithDefaults({}),
      valid: false,
      issues,
      hash
    }
  }
}
