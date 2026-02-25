import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('@main/common/eventbus', async () => {
  const { EventEmitter } = await import('node:events');
  return { eventBus: new EventEmitter() };
});

import { emitEventTool } from '../builtin/emit-event';
import { eventBus } from '@main/common/eventbus';
import type { ToolExecutionContext } from '../types';

async function consumeGenerator(
  gen: AsyncGenerator<unknown, unknown, unknown>
): Promise<{ yields: unknown[]; result: unknown }> {
  const yields: unknown[] = [];
  let step = await gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = await gen.next();
  }
  return { yields, result: step.value };
}

describe('emit_event tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit event via eventBus', async () => {
    const spy = vi.fn();
    eventBus.on('agent:event', spy);

    const gen = emitEventTool.execute!(
      { event: 'open-preview', payload: { url: 'http://localhost:3000' } },
      undefined,
      { sessionId: 'sess-1', agentName: 'test-agent' } as ToolExecutionContext
    );

    const { result } = await consumeGenerator(gen);

    expect(spy).toHaveBeenCalledTimes(1);
    const emitted = spy.mock.calls[0][0];
    expect(emitted._event).toBe('open-preview');
    expect(emitted.url).toBe('http://localhost:3000');
    expect(emitted._sessionId).toBe('sess-1');
    expect(emitted._agentName).toBe('test-agent');
    expect((result as { success: boolean }).success).toBe(true);

    eventBus.off('agent:event', spy);
  });

  it('should reject empty event name', async () => {
    const gen = emitEventTool.execute!({ event: '' }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
  });

  it('should work without payload', async () => {
    const spy = vi.fn();
    eventBus.on('agent:event', spy);

    const gen = emitEventTool.execute!({ event: 'notify' }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]._event).toBe('notify');

    eventBus.off('agent:event', spy);
  });
});
