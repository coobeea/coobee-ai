/**
 * StreamEmitter.forward() 测试
 *
 * 测试直接透传 — StreamChunk.type 原样广播为 StreamMessage.type：
 * - text:delta → text:delta（直接透传）
 * - tool:start → tool:start（直接透传）
 * - run:start / run:done / run:error → 额外触发 START/END/ERROR 生命周期事件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEventBus = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

vi.mock('@main/utils', () => ({
  SnowflakeIdGenerator: class MockSnowflakeIdGenerator {
    private counter = 0;
    nextId(): string {
      return `snowflake-${++this.counter}`;
    }
  }
}));

import { StreamEmitter } from '../StreamEmitter';
import { StreamEventType } from '../types';
import type { StreamChunk } from '../../runtime/types';

describe('StreamEmitter.forward()', () => {
  let emitter: StreamEmitter;
  const source = { type: 'agent' as const, id: 'agent-1', name: 'TestAgent' };

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new StreamEmitter('session-1', source);
  });

  describe('直接透传', () => {
    it.each([
      ['text:delta', 'hello'],
      ['reasoning:delta', 'thinking...'],
      ['tool:start', 'search'],
      ['tool:done', 'result'],
      ['hitl:required', 'approval needed'],
      ['hitl:approved', 'approved'],
      ['hitl:rejected', 'rejected'],
      ['handoff:start', 'Agent B'],
      ['delegate:start', 'delegate'],
      ['delegate:done', 'done'],
      ['run:interrupted', ''],
      ['run:resumed', ''],
      ['turn:start', ''],
      ['turn:done', ''],
      ['llm:start', ''],
      ['llm:done', ''],
      ['text:start', ''],
      ['text:done', '']
    ])('%s → type 原样透传', (type, content) => {
      emitter.forward({ type, content } as StreamChunk);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            type,
            content,
            sessionId: 'session-1'
          })
        })
      );
    });
  });

  describe('生命周期事件', () => {
    it('run:start 额外触发 START 事件', () => {
      emitter.forward({ type: 'run:start', content: '' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'run:start' })
        })
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.START,
        expect.objectContaining({
          type: StreamEventType.START,
          sessionId: 'session-1',
          source
        })
      );
    });

    it('run:done 额外触发 END 事件', () => {
      emitter.forward({ type: 'run:done', content: '' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'run:done' })
        })
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.END,
        expect.objectContaining({ type: StreamEventType.END })
      );
    });

    it('run:error 额外触发 ERROR 事件（含 error 字段）', () => {
      emitter.forward({ type: 'run:error', content: 'something broke' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({ type: 'run:error', content: 'something broke' })
        })
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        StreamEventType.ERROR,
        expect.objectContaining({
          error: 'something broke'
        })
      );
    });
  });

  describe('序号递增', () => {
    it('forward 产生的消息序号单调递增', () => {
      emitter.forward({ type: 'text:delta', content: '1' });
      emitter.forward({ type: 'text:delta', content: '2' });
      emitter.forward({ type: 'text:delta', content: '3' });

      const calls = mockEventBus.emit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c[0] === StreamEventType.MESSAGE
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sequences = calls.map((c: any) => c[1].message.sequence);
      expect(sequences).toEqual([1, 2, 3]);
    });
  });
});
