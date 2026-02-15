/**
 * 配置默认值
 *
 * 当配置文件不存在或某些字段缺失时，使用这些默认值。
 * Zod schema 的 .default() 负责字段级默认值；
 * 此处提供完整的"空配置"结构作为兜底。
 */
import type { CoobeeConfig } from './schema'

/** 完整的默认配置 */
export const DEFAULT_CONFIG: CoobeeConfig = {
  models: {
    providers: {}
  },
  agents: {
    defaults: {
      model: undefined
    },
    list: []
  },
  messages: {
    queue: {
      mode: 'collect',
      debounceMs: 500,
      cap: 20,
      dropPolicy: 'summarize'
    }
  },
  tools: {
    exec: {
      timeout: 30000,
      blacklist: []
    }
  },
  security: {
    sandbox: { mode: 'path-only' },
    approvals: { exec: 'auto' }
  },
  ui: {
    theme: 'auto',
    language: 'zh-CN',
    soundEffects: true
  },
  logging: {
    level: 'info',
    file: true
  }
}

/**
 * 深度合并用户配置和默认配置
 *
 * 用户配置优先；缺失字段从默认值填充。
 */
export function mergeWithDefaults(userConfig: CoobeeConfig): CoobeeConfig {
  return deepMerge(DEFAULT_CONFIG, userConfig) as CoobeeConfig
}

/**
 * 递归深度合并，source 覆盖 target
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = target[key]

    if (sourceVal === undefined) {
      continue
    }

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      )
    } else {
      result[key] = sourceVal
    }
  }

  return result
}
