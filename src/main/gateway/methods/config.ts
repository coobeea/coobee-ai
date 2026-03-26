/**
 * Gateway Config 方法组
 *
 * 方法：
 *   config.get    — 获取指定配置节
 *   config.getAll — 获取完整配置
 *   config.set    — 设置指定配置节
 *   config.patch  — 部分更新配置
 */

import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

import { configStoreInstance } from '@main/common/config/ConfigStore';
import { saveSecret } from '@main/common/config/ConfigSecrets';
import type { CoobeeConfig } from '@main/common/config/schema';

/** 获取 ConfigStore 实例 */
function getConfigStore(): typeof configStoreInstance {
  return configStoreInstance;
}

/** 脱敏配置中的 API Key，防止泄露到前端 */
function maskApiKeys(config: CoobeeConfig): CoobeeConfig {
  const cloned = structuredClone(config);
  const providers = cloned.models?.providers;
  if (!providers) return cloned;

  for (const provider of Object.values(providers)) {
    if (provider.apiKey && provider.apiKey.length > 0) {
      // 保留前4位，其余用 * 替代
      const key = provider.apiKey;
      provider.apiKey = key.length > 8 ? key.slice(0, 4) + '***' + key.slice(-4) : '***';
    }
  }
  return cloned;
}

export const configMethods: MethodGroup = {
  namespace: 'config',
  methods: {
    get: async (params) => {
      const { key } = params as { key?: string };
      if (!key) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'key is required');
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      const config = maskApiKeys(store.getAll());
      const value = config[key as keyof typeof config];
      return { key, value: value ?? null };
    },

    getAll: async () => {
      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }
      return maskApiKeys(store.getAll());
    },

    set: async (params) => {
      const { key, value } = params as { key?: string; value?: unknown };
      if (!key) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'key is required');
      }

      // 防止设置非法 key，避免配置注入风险
      const validTopLevelKeys = ['models', 'messages', 'tools', 'security', 'ui', 'logging'];
      const topLevelKey = key.split('.')[0];
      if (!validTopLevelKeys.includes(topLevelKey)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Invalid config key: ${key}`);
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.set(key as any, value as any);
      return { success: true };
    },

    patch: async (params) => {
      const { partial } = params as { partial?: Record<string, unknown> };
      if (!partial || typeof partial !== 'object') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'partial object is required');
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.patch(partial as any);
      return { success: true };
    },

    /**
     * 保存供应商 API Key 到 secrets.json5
     *
     * @param providerId - 供应商 ID
     * @param apiKey - API Key（空字符串表示清空）
     */
    saveProviderKey: async (params) => {
      const { providerId, apiKey } = params as { providerId?: string; apiKey?: string };
      if (!providerId || typeof providerId !== 'string') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'providerId is required');
      }
      if (typeof apiKey !== 'string') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'apiKey must be a string');
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      saveSecret(store.secretsDir, providerId, apiKey);
      store.getAll(); // force reload to pick up new key
      return { success: true };
    },

    /**
     * 切换供应商启用/禁用状态
     *
     * @param providerId - 供应商 ID
     * @param enabled - 是否启用
     */
    toggleProvider: async (params) => {
      const { providerId, enabled } = params as { providerId?: string; enabled?: boolean };
      if (!providerId || typeof providerId !== 'string') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'providerId is required');
      }
      if (typeof enabled !== 'boolean') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'enabled must be a boolean');
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      store.patch({
        models: {
          providers: {
            [providerId]: { enabled }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      return { success: true };
    },

    /**
     * 更新供应商 Base URL
     *
     * @param providerId - 供应商 ID
     * @param baseUrl - 新的 Base URL
     */
    updateProviderBaseUrl: async (params) => {
      const { providerId, baseUrl } = params as { providerId?: string; baseUrl?: string };
      if (!providerId || typeof providerId !== 'string') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'providerId is required');
      }
      if (typeof baseUrl !== 'string') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'baseUrl must be a string');
      }

      const store = getConfigStore();
      if (!store) {
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, 'Config system not initialized');
      }

      store.patch({
        models: {
          providers: {
            [providerId]: { baseUrl }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      return { success: true };
    }
  }
};
