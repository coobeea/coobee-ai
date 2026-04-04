import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/plugins/gatewaySetup', () => {
  const request = vi.fn().mockResolvedValue({ ok: true });
  return {
    gateway: {
      request,
      on: vi.fn(),
      onConnect: vi.fn(),
      connectionState: { value: 'connected' }
    }
  };
});
vi.mock('@/config', () => ({
  default: {
    getBaseUrl: vi.fn(),
    getGatewayWsUrl: vi.fn(),
    getWsUrl: vi.fn(),
    getPort: vi.fn(),
    getTimeout: vi.fn()
  }
}));

import { useChatStore } from '../chat';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

describe('chatStore submitDecision with subSessionId', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('routes approval to sub-session when present', async () => {
    const store = useChatStore();
    const decision: HitlApprovalDecision = 'approve-once';
    const threadId = 'thread-1';
    const subSessionId = 'thread-1:delegate:child';

    // 新架构：submitDecision 接收 sessionId 参数
    await store.submitDecision(threadId, 0, decision, subSessionId);

    const { gateway } = await import('@/plugins/gatewaySetup');
    expect(gateway.request).toHaveBeenCalledWith('hitl.decide', {
      sessionId: subSessionId,
      index: 0,
      decision
    });
  });
});
