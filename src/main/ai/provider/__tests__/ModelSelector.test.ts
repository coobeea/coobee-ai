import { describe, expect, it, beforeEach } from 'vitest';

import type { CoobeeConfig } from '@main/common/config/schema';

import { ModelSelector } from '../ModelSelector';

describe('ModelSelector', () => {
  let selector: ModelSelector;

  const config: CoobeeConfig = {
    models: {
      defaults: {
        model: {
          primary: 'aliyun/qwen3-max',
          fallbacks: ['openai/gpt-4o']
        }
      }
    }
  };

  beforeEach(() => {
    selector = new ModelSelector(config);
  });

  // ─── 优先级 ─────────────────────────────────

  it('should resolve to global default when no overrides', () => {
    const ref = selector.resolve();
    expect(ref.provider).toBe('aliyun');
    expect(ref.model).toBe('qwen3-max');
  });

  it('should resolve to builtin default when no config', () => {
    const emptySelector = new ModelSelector({});
    const ref = emptySelector.resolve();
    expect(ref.provider).toBe('openai');
    expect(ref.model).toBe('gpt-4o');
  });

  it('should fall back to global when agent has no runtime override', () => {
    const ref = selector.resolve({ agentId: 'chat' });
    expect(ref.provider).toBe('aliyun');
    expect(ref.model).toBe('qwen3-max');
  });

  it('should resolve agent runtime override (Level 2)', () => {
    selector.setAgentOverride('coder', 'anthropic/claude-sonnet-4');
    const ref = selector.resolve({ agentId: 'coder' });
    expect(ref.provider).toBe('anthropic');
    expect(ref.model).toBe('claude-sonnet-4');
  });

  it('should resolve session override (Level 1)', () => {
    selector.setSessionOverride('session-1', 'minimax/MiniMax-M1');
    const ref = selector.resolve({ sessionId: 'session-1', agentId: 'coder' });
    expect(ref.provider).toBe('minimax');
    expect(ref.model).toBe('MiniMax-M1');
  });

  it('should clear session override', () => {
    selector.setSessionOverride('session-1', 'minimax/MiniMax-M1');
    selector.clearSessionOverride('session-1');
    const ref = selector.resolve({ sessionId: 'session-1' });
    // Falls back to global default
    expect(ref.provider).toBe('aliyun');
  });

  // ─── 自定义 fallback default ──────────────────

  it('should use custom fallback default', () => {
    const emptySelector = new ModelSelector({});
    emptySelector.setFallbackDefault('anthropic/claude-sonnet-4');
    const ref = emptySelector.resolve();
    expect(ref.provider).toBe('anthropic');
    expect(ref.model).toBe('claude-sonnet-4');
  });

  // ─── resolveWithFallbacks ─────────────────────

  it('should return primary with fallbacks', () => {
    const result = selector.resolveWithFallbacks();
    expect(result.primary).toBe('aliyun/qwen3-max');
    expect(result.fallbacks).toEqual(['openai/gpt-4o']);
  });

  it('should filter out primary from fallbacks', () => {
    // primary is aliyun/qwen3-max, fallbacks include openai/gpt-4o
    const result = selector.resolveWithFallbacks();
    expect(result.fallbacks).not.toContain('aliyun/qwen3-max');
  });

  it('should return undefined fallbacks when none available', () => {
    const noFallbackConfig: CoobeeConfig = {
      models: { defaults: { model: { primary: 'openai/gpt-4o' } } }
    };
    const sel = new ModelSelector(noFallbackConfig);
    const result = sel.resolveWithFallbacks();
    expect(result.fallbacks).toBeUndefined();
  });

  // ─── updateConfig ─────────────────────────────

  it('should update config for hot-reload', () => {
    const newConfig: CoobeeConfig = {
      models: { defaults: { model: { primary: 'anthropic/claude-sonnet-4' } } }
    };
    selector.updateConfig(newConfig);
    const ref = selector.resolve();
    expect(ref.provider).toBe('anthropic');
    expect(ref.model).toBe('claude-sonnet-4');
  });
});
