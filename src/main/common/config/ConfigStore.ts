/**
 * 配置存储接口
 *
 * 提供类型安全的 get/set/patch，读写 coobee.json5。
 */
import fs from 'fs'
import JSON5 from 'json5'

import { ConfigLoader } from './ConfigLoader'
import type { CoobeeConfig } from './schema'

/** 深度部分类型 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export class ConfigStore {
  constructor(private loader: ConfigLoader) {}

  /**
   * 获取指定配置节
   */
  get<K extends keyof CoobeeConfig>(key: K): CoobeeConfig[K] {
    const config = this.loader.load()
    return config[key]
  }

  /**
   * 设置指定配置节
   */
  set<K extends keyof CoobeeConfig>(key: K, value: CoobeeConfig[K]): void {
    const raw = this.readRawConfig()
    raw[key] = value
    this.writeRawConfig(raw)
    this.loader.clearCache()
  }

  /**
   * 部分更新配置（深度合并）
   */
  patch(partial: DeepPartial<CoobeeConfig>): void {
    const raw = this.readRawConfig()
    const merged = deepMerge(raw, partial as Record<string, unknown>)
    this.writeRawConfig(merged as Record<string, unknown>)
    this.loader.clearCache()
  }

  /**
   * 获取完整配置
   */
  getAll(): CoobeeConfig {
    return this.loader.load()
  }

  // ─── 私有方法 ─────────────────────────────────────

  /** 读取原始 JSON5 对象（不经过 Zod 校验） */
  private readRawConfig(): Record<string, unknown> {
    const filePath = this.loader.configPath
    if (!fs.existsSync(filePath)) {
      return {}
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    try {
      return JSON5.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  /** 写入 JSON5 配置文件（保持 JSON5 格式一致性） */
  private writeRawConfig(config: Record<string, unknown>): void {
    this.loader.ensureConfigFile()
    const content = JSON5.stringify(config, null, 2)
    fs.writeFileSync(this.loader.configPath, content, 'utf-8')
  }
}

/**
 * 全局 ConfigStore 实例（应用初始化时设置）
 *
 * Gateway 方法通过此变量访问 ConfigStore。
 */
export let configStoreInstance: ConfigStore | null = null

/**
 * 设置全局 ConfigStore 实例
 */
export function setConfigStoreInstance(store: ConfigStore): void {
  configStoreInstance = store
}

/** 递归深度合并 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]

    if (sv === undefined) continue

    if (
      sv !== null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
    } else {
      result[key] = sv
    }
  }

  return result
}
