/**
 * ProviderInjector — Provider 配置注入
 *
 * 负责将 Provider 系统（Registry + Selector）的配置注入到 PiMonoBuilder：
 *   - API Key + model + baseURL
 *   - 默认思维链级别
 *
 * 从 AgentExecutor 提取，供 chat.ts、Orchestrator、Swarm 等所有创建 Agent 的地方使用。
 */

import type { ProviderRegistry } from './ProviderRegistry';
import type { ModelSelector } from './ModelSelector';
import type { PiMonoBuilder } from '../runtime/pimono/PiMonoBuilder';
import { resolveApiKey } from './ApiKeyResolver';

export interface ProviderSystem {
  registry: ProviderRegistry;
  selector: ModelSelector;
}

export class ProviderInjector {
  private providerSystem: ProviderSystem | null = null;

  setProviderSystem(system: ProviderSystem): void {
    this.providerSystem = system;
  }

  getProviderSystem(): ProviderSystem | null {
    return this.providerSystem;
  }

  /**
   * 注入 Provider 配置到 Builder（API Key + 模型 + baseURL）
   *
   * 支持 @group-name 和 auto 格式，通过 ModelGroupResolver 解析为具体模型。
   * 如果 Provider 系统未就绪或无可用配置，静默回退。
   */
  applyProviderConfig(
    builder: PiMonoBuilder,
    opts?: { modelOverride?: string; sessionId?: string; agentId?: string }
  ): void {
    try {
      if (!this.providerSystem) return;
      const { selector, registry } = this.providerSystem;
      const ref = selector.resolve({
        modelOverride: opts?.modelOverride,
        sessionId: opts?.sessionId,
        agentId: opts?.agentId
      });
      const provider = registry.get(ref.provider);
      if (!provider) return;

      const apiKey = resolveApiKey(provider.apiKey, provider.id);
      if (!apiKey) return;

      builder.fromProviderConfig(provider, ref.model);
    } catch {
      // Provider 系统未就绪，静默回退
    }
  }

  /**
   * 注入默认思维链级别到 Builder
   *
   * 从 coobee.json5 读取 models.defaults.thinkingLevel，默认 'medium'。
   * 注意：这是同步方法，使用延迟导入避免循环依赖。
   */
  applyThinkingLevel(builder: PiMonoBuilder): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const config = configStoreInstance?.getAll?.();
      const level = config?.models?.defaults?.thinkingLevel;
      if (level) {
        builder.thinkingLevel(level);
        return;
      }
    } catch {
      // 静默回退
    }
    builder.thinkingLevel('medium');
  }
}
