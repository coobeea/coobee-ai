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

import type { ModelRef, ModelSelectionConfig } from './types';
import { parseModelRef } from './types';

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

  constructor(private config: CoobeeConfig) {}

  /**
   * 更新配置（热重载时调用）
   */
  updateConfig(config: CoobeeConfig): void {
    this.config = config;
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
   * 四级优先级解析模型
   *
   * @param opts 解析选项
   * @returns 解析后的 ModelRef
   */
  resolve(opts: { sessionId?: string; agentId?: string } = {}): ModelRef {
    let source = 'builtin';

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
    const globalDefault = this.config.agents?.defaults?.model?.primary;
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
    const fallbacks = this.config.agents?.defaults?.model?.fallbacks ?? [];

    // 过滤掉与 primary 相同的
    const filteredFallbacks = fallbacks.filter((f) => f !== primaryStr);

    return {
      primary: primaryStr,
      fallbacks: filteredFallbacks.length > 0 ? filteredFallbacks : undefined
    };
  }
}
