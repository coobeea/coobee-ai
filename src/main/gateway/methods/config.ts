/**
 * Gateway Config 方法组
 *
 * 方法：
 *   config.get    — 获取指定配置节
 *   config.getAll — 获取完整配置
 *   config.set    — 设置指定配置节
 *   config.patch  — 部分更新配置
 */

import { GatewayErrorCode, GatewayMethodError } from '../protocol'
import type { MethodGroup } from '../protocol'

import { configStoreInstance } from '@main/common/config/ConfigStore'

/** 获取 ConfigStore 实例 */
function getConfigStore(): typeof configStoreInstance {
  return configStoreInstance
}

export const configMethods: MethodGroup = {
  namespace: 'config',
  methods: {
    get: async (params) => {
      const { key } = params as { key?: string }
      if (!key) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'key is required')
      }

      const store = getConfigStore()
      if (!store) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'Config system not initialized'
        )
      }

      const config = store.getAll()
      const value = config[key as keyof typeof config]
      return { key, value: value ?? null }
    },

    getAll: async () => {
      const store = getConfigStore()
      if (!store) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'Config system not initialized'
        )
      }
      return store.getAll()
    },

    set: async (params) => {
      const { key, value } = params as { key?: string; value?: unknown }
      if (!key) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'key is required')
      }

      const store = getConfigStore()
      if (!store) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'Config system not initialized'
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.set(key as any, value as any)
      return { success: true }
    },

    patch: async (params) => {
      const { partial } = params as { partial?: Record<string, unknown> }
      if (!partial || typeof partial !== 'object') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'partial object is required')
      }

      const store = getConfigStore()
      if (!store) {
        throw new GatewayMethodError(
          GatewayErrorCode.INTERNAL_ERROR,
          'Config system not initialized'
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.patch(partial as any)
      return { success: true }
    }
  }
}
