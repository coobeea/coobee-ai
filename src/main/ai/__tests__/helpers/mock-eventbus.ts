/**
 * Mock EventBus
 * 替代真实的 EventBus，记录所有发射的事件
 */
import { vi } from 'vitest';

export interface MockEventBusEvent {
  eventName: string;
  data: unknown;
  timestamp: number;
}

export function createMockEventBus(): Record<string, unknown> {
  const events: MockEventBusEvent[] = [];

  return {
    emit: vi.fn((eventName: string, data: unknown) => {
      events.push({
        eventName,
        data,
        timestamp: Date.now()
      });
    }),
    on: vi.fn(),
    off: vi.fn(),
    getEmittedEvents: () => events,
    getEventsByName: (name: string) => events.filter((e) => e.eventName === name),
    clear: () => {
      events.length = 0;
    }
  };
}
