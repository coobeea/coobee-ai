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
import type { StreamChatMessage } from '@/composables/useStreamHandler';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

describe('chatStore submitDecision with subSessionId', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('routes approval to sub-session when present on pending approval', async () => {
    const store = useChatStore();
    const decision: HitlApprovalDecision = 'approve-once';

    const msg: StreamChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      blocks: [],
      status: 'done',
      timestamp: Date.now(),
      pendingApprovals: [
        {
          index: 0,
          toolName: 'exec',
          sessionId: 'thread-1:delegate:child',
          canShow: true
        }
      ]
    };
    store.messages.push(msg);

    await store.submitDecision('thread-1', 0, decision);

    const { gateway } = await import('@/plugins/gatewaySetup');
    expect(gateway.request).toHaveBeenCalledWith('hitl.decide', {
      sessionId: 'thread-1:delegate:child',
      index: 0,
      decision
    });
  });
});
