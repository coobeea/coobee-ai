/**
 * config_patch — 配置修改工具
 *
 * 让 Agent 通过 ConfigStore.patch() 安全地修改 coobee.json5 配置。
 * 支持深度合并，修改后自动热重载。
 *
 * 安全：
 *   - 需要用户确认（needUserConfirm: true）
 *   - 写入前经过 Zod Schema 校验，防止畸形数据
 *   - API Key 自动脱敏（ConfigStore 内置保护）
 *
 * 分类：Configuration | 风险：中（修改应用配置）
 */
import JSON5 from 'json5';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';

export const configPatchTool: ToolDefinition = {
  name: 'config_patch',
  description:
    'Modify application configuration (coobee.json5). ' +
    'Accepts a JSON5 patch object that is deep-merged into the current config. ' +
    'Use this to change sandbox mode, model settings, approvals, and other system options. ' +
    'Changes take effect immediately via hot-reload. ' +
    'Example: {"security": {"sandbox": {"mode": "off"}}} to disable sandbox.',
  category: ToolCategory.Configuration,
  needUserConfirm: true,
  parameters: z.object({
    patch: z
      .string()
      .describe(
        'JSON5 string representing the config patch to apply. ' +
          'Will be deep-merged into current config. ' +
          'Example: \'{"security": {"sandbox": {"mode": "off"}}}\''
      ),
    description: z.string().optional().describe('Human-readable description of what this change does')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const patchStr = params.patch as string;
    const description = (params.description as string) || 'Config update';
    const startTime = Date.now();

    // 1. 解析 patch 对象
    let patchObj: Record<string, unknown>;
    try {
      patchObj = JSON5.parse(patchStr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        llmContent: `Error: Invalid JSON5 in patch: ${msg}`,
        error: { code: 'INVALID_JSON5', message: `Failed to parse patch: ${msg}` }
      };
    }

    if (typeof patchObj !== 'object' || patchObj === null || Array.isArray(patchObj)) {
      return {
        success: false,
        llmContent: 'Error: patch must be a JSON5 object (not array or primitive)',
        error: { code: 'INVALID_PATCH', message: 'patch must be a JSON5 object' }
      };
    }

    yield { type: 'progress', content: `Applying config patch: ${description}...`, percentage: 0 };

    // 2. 获取 ConfigStore 实例
    let configStore: import('@main/common/config/ConfigStore').ConfigStore;
    try {
      const { configStoreInstance } = await import('@main/common/config/ConfigStore');
      if (!configStoreInstance) {
        return {
          success: false,
          llmContent: 'Error: ConfigStore not initialized. Application may still be starting.',
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

    yield { type: 'progress', content: 'Validating and applying...', percentage: 50 };

    // 3. 应用 patch
    try {
      // ConfigStore.patch() 内部执行：
      //   - 深度合并到当前配置
      //   - Zod Schema 校验（防止畸形数据）
      //   - 原子写入（临时文件 + rename）
      //   - 清除缓存（触发热重载）
      configStore!.patch(patchObj);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        llmContent: `Error: Config patch failed: ${msg}`,
        error: { code: 'PATCH_FAILED', message: msg }
      };
    }

    // 4. 读取更新后的配置确认
    let verifyKeys: string[] = [];
    try {
      verifyKeys = Object.keys(patchObj);
    } catch {
      // 忽略
    }

    const duration = Date.now() - startTime;
    const summary =
      `Successfully applied config patch: ${description}\n` +
      `Modified sections: ${verifyKeys.join(', ') || 'unknown'}\n` +
      `Changes take effect immediately (hot-reload).`;

    yield { type: 'output', content: summary };

    return {
      success: true,
      llmContent: summary,
      userContent: summary,
      metadata: { startTime, endTime: Date.now(), duration }
    };
  }
};
