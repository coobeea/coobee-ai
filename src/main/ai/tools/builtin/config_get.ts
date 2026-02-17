/**
 * config_get — 配置查看工具
 *
 * 让 Agent 查看当前生效的配置（经过 Schema 校验 + 默认值填充后的值）。
 * 支持查看全部配置或指定配置节。
 *
 * 安全：
 *   - 只读操作，不需要用户确认
 *   - API Key 自动脱敏（显示为 ****）
 *
 * 分类：Configuration | 风险：低（只读）
 */
import JSON5 from 'json5';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';

export const configGetTool: ToolDefinition = {
  name: 'config_get',
  description:
    'View current application configuration (coobee.json5). ' +
    'Returns the effective config after schema validation and default values. ' +
    'Use key parameter to view a specific section (e.g. "models", "security", "tools"). ' +
    'This tool shows system settings only — NOT agent/skill lists. ' +
    'To list agents use manage_agent(list), to list skills use manage_skill(list). ' +
    'API keys are masked for security.',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  parameters: z.object({
    key: z
      .string()
      .optional()
      .describe(
        'Config section to view: "models", "messages", "tools", "security", "ui", "logging". ' +
          'Omit to view all sections.'
      )
  }),

  execute: async function* (params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const key = params.key as string | undefined;
    const startTime = Date.now();

    yield { type: 'progress', content: 'Reading configuration...', percentage: 0 };

    // 获取 ConfigStore 实例
    let configStore: import('@main/common/config/ConfigStore').ConfigStore;
    try {
      const { configStoreInstance } = await import('@main/common/config/ConfigStore');
      if (!configStoreInstance) {
        return {
          success: false,
          llmContent: 'Error: ConfigStore not initialized.',
          error: { code: 'NOT_INITIALIZED', message: 'ConfigStore instance not available' }
        };
      }
      configStore = configStoreInstance;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        llmContent: `Error: Failed to load ConfigStore: ${msg}`,
        error: { code: 'IMPORT_ERROR', message: msg }
      };
    }

    yield { type: 'progress', content: 'Formatting...', percentage: 50 };

    try {
      let result: unknown;

      if (key) {
        const validKeys = ['models', 'messages', 'tools', 'security', 'ui', 'logging'];
        if (!validKeys.includes(key)) {
          return {
            success: false,
            llmContent: `Error: Unknown config key "${key}". Valid keys: ${validKeys.join(', ')}`,
            error: { code: 'INVALID_KEY', message: `Unknown key: ${key}` }
          };
        }
        result = configStore.get(key as keyof import('@main/common/config/schema').CoobeeConfig);
      } else {
        result = configStore.getAll();
      }

      // 脱敏 API Key
      const sanitized = maskApiKeys(result);
      const formatted = JSON5.stringify(sanitized, null, 2);

      const label = key ? `config.${key}` : 'config (all sections)';
      const summary = `Current ${label}:\n\n${formatted}`;

      yield { type: 'output', content: summary };

      return {
        success: true,
        llmContent: summary,
        metadata: { startTime, endTime: Date.now(), duration: Date.now() - startTime }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        llmContent: `Error: Failed to read config: ${msg}`,
        error: { code: 'READ_FAILED', message: msg }
      };
    }
  }
};

/**
 * 递归脱敏 API Key
 *
 * 将所有名为 apiKey 的字段值替换为 ****，防止泄漏。
 */
function maskApiKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskApiKeys);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === 'apiKey' && typeof v === 'string' && v.length > 0) {
      result[k] = '****';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = maskApiKeys(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}
