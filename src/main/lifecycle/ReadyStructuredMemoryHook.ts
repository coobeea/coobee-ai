/**
 * Structured Memory Hook — 结构化记忆服务初始化
 *
 * 在 READY 阶段、ReadyInfraHook (55) 之后初始化 StructuredMemoryService。
 *
 * 依赖：
 *   - SQLiteService (INIT 阶段由 InitDatabaseHook 完成)
 *   - AgentExecutor + ProviderSystem (READY 阶段由 ReadyInfraHook 完成)
 *
 * 执行顺序：
 *   ReadyInfraHook (55) → ReadyStructuredMemoryHook (56) → ReadyWorkerHook (80)
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';
import type { AgentExecutorLike } from '@main/ai/quality-loop/llm-chat';

export const ReadyStructuredMemoryHook: LifecycleHook = {
  name: 'ready-structured-memory',
  phase: LifecyclePhase.READY,
  priority: 56,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyStructuredMemoryHook] Initializing StructuredMemoryService...');

    try {
      const { StructuredMemoryService } = await import('@main/ai/memory/structured/service');
      const { createLLMChat } = await import('@main/ai/quality-loop/llm-chat');
      const { agentExecutor } = await import('@main/ai/AgentExecutor');
      const { configStoreInstance } = await import('@main/common/config/ConfigStore');

      const config = (configStoreInstance?.getAll?.() ?? {}) as Record<string, unknown>;

      // 从 provider 配置中尝试获取可用于 embedding 的 API key 和 baseURL
      const embeddingConfig = resolveEmbeddingConfig(config);

      const svc = StructuredMemoryService.getInstance();
      await svc.initialize({
        llmChat: createLLMChat(agentExecutor as unknown as AgentExecutorLike),
        embeddingApiKey: embeddingConfig?.apiKey,
        embeddingBaseURL: embeddingConfig?.baseURL
      });

      const stats = await svc.getStats();
      log.info(
        `[ReadyStructuredMemoryHook] StructuredMemoryService initialized` +
          (stats ? ` (${stats.totalItems} items, ${stats.totalCategories} categories)` : '') +
          (embeddingConfig ? ' [embedding: enabled]' : ' [embedding: noop]')
      );
    } catch (error) {
      log.warn('[ReadyStructuredMemoryHook] StructuredMemoryService init failed (non-critical):', error);
    }
  }
};

interface EmbeddingConfig {
  apiKey: string;
  baseURL?: string;
}

/**
 * 从配置中解析可用于 embedding 的 provider。
 *
 * 配置结构：config.models.providers[id].apiKey / baseUrl（含 secrets 合并后的值）
 *
 * 优先查找支持 OpenAI 兼容 embedding API 的 provider。
 */
function resolveEmbeddingConfig(config: Record<string, unknown>): EmbeddingConfig | undefined {
  const models = config.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers) return undefined;

  const embeddingCandidates = ['silicon', 'dashscope', 'dashscope-subscription', 'openai', 'deepseek'];
  for (const id of embeddingCandidates) {
    const provider = providers[id];
    if (provider?.apiKey && typeof provider.apiKey === 'string' && provider.apiKey.length > 0) {
      return {
        apiKey: provider.apiKey,
        baseURL: typeof provider.baseUrl === 'string' ? provider.baseUrl : undefined
      };
    }
  }

  return undefined;
}

export const BeforeQuitStructuredMemoryHook: LifecycleHook = {
  name: 'before-quit-structured-memory',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 30,
  critical: false,

  async execute(): Promise<void> {
    try {
      const { StructuredMemoryService } = await import('@main/ai/memory/structured/service');
      StructuredMemoryService.destroyInstance();
      log.info('[BeforeQuitStructuredMemoryHook] StructuredMemoryService closed');
    } catch {
      // 静默处理
    }
  }
};
