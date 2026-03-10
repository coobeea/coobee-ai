/**
 * 模型选择器
 *
 * 三级优先级选择（高 → 低）：
 * 1. 会话覆盖 (sessionOverrides)
 * 2. Agent 覆盖 (agentOverrides — 运行时设置)
 * 3. 全局默认 (config agents.defaults.model)
 * 4. 内置默认 (fallbackDefault)
 *
 * 注：Agent 定义中的 model 字段由 chat.ts 的 createBuilderFromDefinition 直接处理，
 *     不经过 ModelSelector。
 */
import type { CoobeeConfig } from '@main/common/config/schema';
import { ExtensionManager } from '@main/common/extension/ExtensionManager';
import { log } from '@main/common/logger';

import type { ModelRef, ModelSelectionConfig } from './types';
import { parseModelRef } from './types';
import { ModelGroupResolver, type ModelSelectionContext } from './ModelGroupResolver';

/** 会话级模型覆盖（运行时设置） */
export interface SessionModelOverride {
  sessionId: string;
  modelRef: string; // "provider/model" 格式
}

export class ModelSelector {
  /** 会话级覆盖（运行时动态设置，优先级最高） */
  private sessionOverrides = new Map<string, string>();

  /** Agent 级覆盖（运行时动态设置） */
  private agentOverrides = new Map<string, string>();

  /** 内置默认模型（作为最终 fallback） */
  private fallbackDefault = 'openai/gpt-4o';

  /** 模型组解析器 */
  private groupResolver: ModelGroupResolver;

  constructor(private config: CoobeeConfig) {
    this.groupResolver = new ModelGroupResolver(config.models?.groups || {});
  }

  /**
   * 更新配置（热重载时调用）
   */
  updateConfig(config: CoobeeConfig): void {
    this.config = config;
    this.groupResolver = new ModelGroupResolver(config.models?.groups || {});
  }

  /**
   * 设置内置默认模型
   */
  setFallbackDefault(modelRef: string): void {
    this.fallbackDefault = modelRef;
  }

  /**
   * 设置会话级覆盖
   */
  setSessionOverride(sessionId: string, modelRef: string): void {
    this.sessionOverrides.set(sessionId, modelRef);
  }

  /**
   * 清除会话级覆盖
   */
  clearSessionOverride(sessionId: string): void {
    this.sessionOverrides.delete(sessionId);
  }

  /**
   * 设置 Agent 级覆盖
   */
  setAgentOverride(agentId: string, modelRef: string): void {
    this.agentOverrides.set(agentId, modelRef);
  }

  /**
   * 🆕 从模型组中选择模型
   */
  resolveModelGroup(groupName: string, context?: ModelSelectionContext): string | null {
    return this.groupResolver.resolveModel(groupName, context);
  }

  /**
   * 获取模型组的所有候选模型（用于故障转移重试）
   *
   * @param modelRef 模型引用，如 "@high-performance" 或 "openai/gpt-4o"
   * @returns 组内模型列表（"provider/model" 格式），非组引用返回 null
   */
  getGroupCandidates(modelRef: string): string[] | null {
    if (!modelRef.startsWith('@')) {
      return null;
    }
    let groupName = modelRef.substring(1);
    if (groupName.startsWith('group:')) {
      groupName = groupName.substring(6);
    }
    const candidates = this.groupResolver.getGroupCandidates(groupName);
    return candidates.length > 0 ? candidates : null;
  }

  /**
   * 🆕 自动选择模型（根据 auto 配置）
   */
  resolveAuto(context?: ModelSelectionContext): string | null {
    const autoConfig = this.config.models?.auto;

    if (!autoConfig || !autoConfig.enabled) {
      log.warn('[ModelSelector] Auto 模式未启用，使用默认模型');
      return null;
    }

    // 如果配置了候选模型，使用候选列表
    const candidates = autoConfig.candidates || this.getAllAvailableModels();

    if (candidates.length === 0) {
      log.warn('[ModelSelector] 没有可用的候选模型');
      return null;
    }

    // 应用过滤器
    const filtered = this.applyFilters(candidates, autoConfig.filters);

    if (filtered.length === 0) {
      log.warn('[ModelSelector] 过滤后没有可用模型');
      return null;
    }

    // 使用配置的策略选择
    const tempGroup = {
      name: 'auto',
      models: filtered,
      strategy: autoConfig.strategy || 'quota-aware',
      enabled: true
    };

    const tempResolver = new ModelGroupResolver({ auto: tempGroup });
    return tempResolver.resolveModel('auto', context);
  }

  /**
   * 四级优先级解析模型
   *
   * @param opts 解析选项
   * @returns 解析后的 ModelRef
   */
  resolve(
    opts: { sessionId?: string; agentId?: string; modelOverride?: string; context?: ModelSelectionContext } = {}
  ): ModelRef {
    let source = 'builtin';
    let modelRefStr: string | null = null;

    // 🆕 检查是否是模型组或 auto 模式
    if (opts.modelOverride) {
      if (opts.modelOverride.startsWith('@')) {
        // 模型组：支持 @group-name 和 @group:group-name 两种格式（前端使用后者）
        let groupName = opts.modelOverride.substring(1);
        if (groupName.startsWith('group:')) {
          groupName = groupName.substring(6);
        }
        modelRefStr = this.resolveModelGroup(groupName, opts.context);
        source = 'model-group';
      } else if (opts.modelOverride === 'auto') {
        // Auto 模式
        modelRefStr = this.resolveAuto(opts.context);
        source = 'auto';
      } else {
        // 普通模型引用
        modelRefStr = opts.modelOverride;
        source = 'override';
      }

      if (modelRefStr) {
        const ref = parseModelRef(modelRefStr);
        this.fireModelResolved(opts.sessionId ?? '', ref, source);
        return ref;
      }
    }

    // Level 1: 会话覆盖
    if (opts.sessionId) {
      const sessionRef = this.sessionOverrides.get(opts.sessionId);
      if (sessionRef) {
        const ref = parseModelRef(sessionRef);
        this.fireModelResolved(opts.sessionId ?? '', ref, 'session');
        return ref;
      }
    }

    // Level 2: Agent 运行时覆盖
    if (opts.agentId) {
      const agentRef = this.agentOverrides.get(opts.agentId);
      if (agentRef) {
        const ref = parseModelRef(agentRef);
        this.fireModelResolved(opts.sessionId ?? '', ref, 'agent-runtime');
        return ref;
      }
    }

    // Level 3: 全局默认
    const globalDefault = this.config.models?.defaults?.model?.primary;
    if (globalDefault) {
      source = 'global';
      const ref = parseModelRef(globalDefault);
      this.fireModelResolved(opts.sessionId ?? '', ref, source);
      return ref;
    }

    // Level 4: 内置默认
    const ref = parseModelRef(this.fallbackDefault);
    this.fireModelResolved(opts.sessionId ?? '', ref, 'builtin');
    return ref;
  }

  /**
   * 获取所有可用模型
   */
  private getAllAvailableModels(): string[] {
    const providers = this.config.models?.providers || {};
    const allModels: string[] = [];

    for (const [providerId, providerConfig] of Object.entries(providers)) {
      if (providerConfig.enabled !== false) {
        for (const model of providerConfig.models) {
          allModels.push(`${providerId}/${model.id}`);
        }
      }
    }

    return allModels;
  }

  /**
   * 应用过滤器
   */
  private applyFilters(
    models: string[],
    filters?: {
      maxCost?: number;
      minContextWindow?: number;
      requireFunctionCalling?: boolean;
      requireVision?: boolean;
    }
  ): string[] {
    if (!filters) return models;

    const providers = this.config.models?.providers || {};
    const filtered: string[] = [];

    for (const modelRef of models) {
      const ref = parseModelRef(modelRef);
      const provider = providers[ref.provider];

      if (!provider) continue;

      const modelConfig = provider.models.find((m) => m.id === ref.model);
      if (!modelConfig) continue;

      // 应用过滤器
      if (filters.maxCost && modelConfig.cost) {
        const avgCost = (modelConfig.cost.input + modelConfig.cost.output) / 2;
        if (avgCost > filters.maxCost) continue;
      }

      if (
        filters.minContextWindow &&
        modelConfig.contextWindow &&
        modelConfig.contextWindow < filters.minContextWindow
      ) {
        continue;
      }

      if (filters.requireFunctionCalling && !modelConfig.functionCalling) {
        continue;
      }

      if (filters.requireVision && !modelConfig.vision) {
        continue;
      }

      filtered.push(modelRef);
    }

    return filtered;
  }

  /** 触发 model_resolved 扩展钩子 */
  private fireModelResolved(sessionId: string, ref: ModelRef, source: string): void {
    ExtensionManager.getHookRunner()
      ?.runVoidHook('model_resolved', {
        sessionId,
        providerId: ref.provider,
        modelId: ref.model,
        source
      })
      .catch(() => {
        /* hook 错误不影响主流程 */
      });
  }

  /**
   * 解析带 Fallback 的完整选择配置
   */
  resolveWithFallbacks(opts: { sessionId?: string; agentId?: string } = {}): ModelSelectionConfig {
    const primary = this.resolve(opts);
    const primaryStr = `${primary.provider}/${primary.model}`;

    // 从全局配置获取 fallbacks
    const fallbacks = this.config.models?.defaults?.model?.fallbacks ?? [];

    // 过滤掉与 primary 相同的
    const filteredFallbacks = fallbacks.filter((f) => f !== primaryStr);

    return {
      primary: primaryStr,
      fallbacks: filteredFallbacks.length > 0 ? filteredFallbacks : undefined
    };
  }
}
