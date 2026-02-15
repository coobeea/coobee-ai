/**
 * Provider 注册中心
 *
 * 管理所有已注册的 Provider 配置，支持从配置系统加载。
 */
import type { CoobeeConfig } from '@main/common/config/schema'

import type { ProviderConfig } from './types'

export class ProviderRegistry {
  private providers = new Map<string, ProviderConfig>()

  /** 注册一个 Provider */
  register(config: ProviderConfig): void {
    this.providers.set(config.id, config)
  }

  /** 注销一个 Provider */
  unregister(id: string): boolean {
    return this.providers.delete(id)
  }

  /** 获取指定 Provider */
  get(id: string): ProviderConfig | undefined {
    return this.providers.get(id)
  }

  /** 获取所有已注册的 Provider */
  getAll(): ProviderConfig[] {
    return Array.from(this.providers.values())
  }

  /** 获取所有启用的 Provider */
  getEnabled(): ProviderConfig[] {
    return this.getAll().filter((p) => p.enabled)
  }

  /** 是否存在指定 Provider */
  has(id: string): boolean {
    return this.providers.has(id)
  }

  /** 已注册的 Provider 数量 */
  get size(): number {
    return this.providers.size
  }

  /** 清空所有 Provider */
  clear(): void {
    this.providers.clear()
  }

  /**
   * 从 CoobeeConfig 加载所有 Provider
   *
   * 会清空现有 Provider 再加载。
   */
  loadFromConfig(config: CoobeeConfig): void {
    this.clear()
    const providers = config.models?.providers
    if (!providers) return

    for (const [id, providerConf] of Object.entries(providers)) {
      this.register({
        id,
        name: id, // 使用 key 作为默认名称
        baseUrl: providerConf.baseUrl,
        apiKey: providerConf.apiKey,
        api: providerConf.api,
        headers: providerConf.headers,
        models: providerConf.models.map((m) => ({
          id: m.id,
          name: m.name,
          api: m.api,
          reasoning: m.reasoning ?? false,
          input: m.input ?? ['text'],
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          cost: m.cost
        })),
        enabled: providerConf.enabled ?? true
      })
    }
  }
}
