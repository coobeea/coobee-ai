import { describe, expect, it } from 'vitest';

import { resolveApiKey } from '../ApiKeyResolver';

describe('ApiKeyResolver', () => {
  const mockEnv = {
    OPENAI_API_KEY: 'sk-openai-123',
    DASHSCOPE_API_KEY: 'sk-dashscope-456',
    CUSTOM_KEY: 'sk-custom-789'
  };

  // ─── 直接值 ──────────────────────────────────

  it('should return plain apiKey directly', () => {
    expect(resolveApiKey('sk-plain-key', 'test', mockEnv)).toBe('sk-plain-key');
  });

  // ─── ${VAR} 模板 ────────────────────────────

  it('should resolve ${VAR} template from env', () => {
    expect(resolveApiKey('${OPENAI_API_KEY}', 'test', mockEnv)).toBe('sk-openai-123');
  });

  it('should resolve ${VAR} template for custom vars', () => {
    expect(resolveApiKey('${CUSTOM_KEY}', 'test', mockEnv)).toBe('sk-custom-789');
  });

  it('should fall back to provider-based env when template var not found', () => {
    // ${NONEXISTENT} 未找到，但 provider id 是 openai，应尝试 OPENAI_API_KEY
    expect(resolveApiKey('${NONEXISTENT}', 'openai', mockEnv)).toBe('sk-openai-123');
  });

  // ─── Provider ID 推断 ──────────────────────

  it('should resolve by provider id when no apiKey configured', () => {
    expect(resolveApiKey(undefined, 'openai', mockEnv)).toBe('sk-openai-123');
  });

  it('should resolve aliyun by known mapping (DASHSCOPE_API_KEY)', () => {
    expect(resolveApiKey(undefined, 'aliyun', mockEnv)).toBe('sk-dashscope-456');
  });

  it('should try generic {PROVIDER_ID}_API_KEY format', () => {
    const env = { CUSTOM_PROVIDER_API_KEY: 'sk-generic' };
    expect(resolveApiKey(undefined, 'custom_provider', env)).toBe('sk-generic');
  });

  // ─── 未找到 ──────────────────────────────────

  it('should return undefined when nothing resolves', () => {
    expect(resolveApiKey(undefined, 'unknown_provider', {})).toBeUndefined();
  });

  it('should return undefined when template and fallbacks all fail', () => {
    expect(resolveApiKey('${NONEXISTENT}', 'unknown_provider', {})).toBeUndefined();
  });
});
