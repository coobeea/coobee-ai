/**
 * 模型目录
 *
 * 基于 ProviderRegistry 提供模型查找、能力查询等功能。
 */
import type { ProviderRegistry } from './ProviderRegistry'
import type { ModelApi, ModelConfig, ModelRef, ProviderConfig, ResolvedModel } from './types'

/** 能力过滤条件 */
export interface CapabilityFilter {
  reasoning?: boolean
  image?: boolean
  minContextWindow?: number
}

export class ModelCatalog {
  constructor(private registry: ProviderRegistry) {}

  /**
   * 查找指定模型
   *
   * @param ref 模型引用（provider + model ID）
   * @returns 解析后的完整模型信息，未找到返回 undefined
   */
  find(ref: ModelRef): ResolvedModel | undefined {
    const provider = this.registry.get(ref.provider)
    if (!provider || !provider.enabled) return undefined

    const model = provider.models.find((m) => m.id === ref.model)
    if (!model) return undefined

    return this.resolveModel(provider, model, ref)
  }

  /**
   * 列出所有可用模型
   */
  listAll(): ResolvedModel[] {
    const results: ResolvedModel[] = []
    for (const provider of this.registry.getEnabled()) {
      for (const model of provider.models) {
        const ref: ModelRef = { provider: provider.id, model: model.id }
        results.push(this.resolveModel(provider, model, ref))
      }
    }
    return results
  }

  /**
   * 按能力过滤模型
   */
  listByCapability(filter: CapabilityFilter): ResolvedModel[] {
    return this.listAll().filter((resolved) => {
      if (filter.reasoning !== undefined && resolved.model.reasoning !== filter.reasoning) {
        return false
      }
      if (filter.image && !resolved.model.input?.includes('image')) {
        return false
      }
      if (
        filter.minContextWindow !== undefined &&
        (resolved.model.contextWindow ?? 0) < filter.minContextWindow
      ) {
        return false
      }
      return true
    })
  }

  /**
   * 获取指定 Provider 的所有模型
   */
  listByProvider(providerId: string): ResolvedModel[] {
    const provider = this.registry.get(providerId)
    if (!provider || !provider.enabled) return []

    return provider.models.map((model) => {
      const ref: ModelRef = { provider: providerId, model: model.id }
      return this.resolveModel(provider, model, ref)
    })
  }

  // ─── 私有方法 ─────────────────────────────────────

  private resolveModel(provider: ProviderConfig, model: ModelConfig, ref: ModelRef): ResolvedModel {
    return {
      ref,
      provider,
      model,
      api: (model.api ?? provider.api) as ModelApi
    }
  }
}
