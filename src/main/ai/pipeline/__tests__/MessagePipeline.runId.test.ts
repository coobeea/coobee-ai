import { describe, expect, it, vi, type Mock } from 'vitest';

// 轻量 Mock，避免主进程依赖（electron-log / env 等）
vi.mock('@main/common/logger', (): { log: Record<string, Mock>; createLogger: Mock } => {
  const dummy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setConsoleLevel: vi.fn() };
  return { log: dummy, createLogger: vi.fn(() => dummy) };
});
import { EventEmitter } from 'events';
vi.mock('@main/common/eventbus', (): { eventBus: EventEmitter } => ({ eventBus: new EventEmitter() }));

import { MessagePipeline } from '../MessagePipeline';

// helper delay
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('MessagePipeline runId allocation', () => {
  it('allocates unique, increasing runIds under back-to-back submits', async () => {
    const observedRunIds: number[] = [];
    const pipeline = new MessagePipeline(async (sessionId) => {
      const runId = pipeline.getRunId(sessionId);
      if (runId !== undefined) observedRunIds.push(runId);
    });

    pipeline.submit('s1', 'm1');
    pipeline.submit('s1', 'm2');

    await tick();
    await tick();

    expect(observedRunIds).toEqual([1, 2]);
  });

  it('does not reuse runIds when hitting MAX_SAFE_INTEGER boundary', async () => {
    const observedRunIds: number[] = [];
    const pipeline = new MessagePipeline(async (sessionId) => {
      const runId = pipeline.getRunId(sessionId);
      if (runId !== undefined) observedRunIds.push(runId);
    });
    (pipeline as unknown as { nextRunId: number }).nextRunId = Number.MAX_SAFE_INTEGER - 1;

    pipeline.submit('s1', 'm1'); // should get MAX_SAFE_INTEGER
    pipeline.submit('s1', 'm2'); // should wrap to 0 -> 1

    await tick();
    await tick();

    expect(observedRunIds).toEqual([Number.MAX_SAFE_INTEGER, 1]);
  });
});
