import { describe, it, expect, beforeEach, vi } from 'vitest';
import { discussionChannel } from '../DiscussionChannel';
import { ChannelRuntime } from '../../../src/main/channels/ChannelRuntime';
import { DiscussionStore } from '../../../src/main/ai/discussion/DiscussionStore';
import { eventBus } from '../../../src/main/common/eventbus';
import type { InboundMessage, OutboundMessage } from '../../../src/main/channels/types';

// Mock dependencies
vi.mock('../../../src/main/channels/ChannelRuntime');
vi.mock('../../../src/main/ai/discussion/DiscussionStore');
vi.mock('../../../src/main/common/eventbus', () => ({
  eventBus: {
    emit: vi.fn()
  }
}));

describe('DiscussionChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct id and name', () => {
      expect(discussionChannel.id).toBe('discussion');
      expect(discussionChannel.name).toBe('Discussion Room');
    });

    it('should have correct capabilities', () => {
      expect(discussionChannel.capabilities).toEqual({
        supportsMultiAgent: true,
        supportsStreaming: false,
        supportsTools: false,
        supportsMedia: false
      });
    });
  });

  describe('lifecycle', () => {
    it('should start successfully', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      const mockStore = {
        getInstance: vi.fn()
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      expect(mockLogger.info).toHaveBeenCalledWith('[DiscussionChannel] Started');
      expect(DiscussionStore.getInstance).toHaveBeenCalled();
    });

    it('should stop successfully', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      // Start first to initialize logger
      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      // Then stop
      await discussionChannel.lifecycle?.stop?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      expect(mockLogger.info).toHaveBeenCalledWith('[DiscussionChannel] Stopped');
    });
  });

  describe('inbound message handling', () => {
    it('should handle inbound message successfully', async () => {
      // Setup mocks
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockSession = {
        id: 'room-1',
        topic: 'Test Topic',
        status: 'active',
        participants: [
          { agentId: 'agent-1', name: 'Agent 1', role: 'Expert', active: true },
          { agentId: 'agent-2', name: 'Agent 2', role: 'Assistant', active: true }
        ],
        messages: [{ agentId: 'agent-1', content: 'Previous message', timestamp: Date.now() }]
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockSession)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const mockRuntime = {
        executeAgent: vi.fn().mockResolvedValue({
          output: 'Agent response',
          error: undefined
        })
      };

      vi.mocked(ChannelRuntime.getInstance).mockReturnValue(mockRuntime as unknown as ChannelRuntime);

      const inboundMsg: InboundMessage = {
        peer: 'room-1',
        from: 'agent-1',
        text: 'Hello everyone',
        context: {
          channel: 'discussion'
        }
      };

      // Handle message
      await discussionChannel.inbound?.handleMessage(inboundMsg);

      // Assertions
      expect(mockStore.get).toHaveBeenCalledWith('room-1');
      expect(mockRuntime.executeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'discussion-room-1-agent-1',
          message: 'Hello everyone',
          context: expect.objectContaining({
            channel: 'discussion',
            roomId: 'room-1',
            topic: 'Test Topic'
          })
        })
      );
    });

    it('should handle session not found', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockStore = {
        get: vi.fn().mockResolvedValue(null)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const inboundMsg: InboundMessage = {
        peer: 'non-existent',
        from: 'agent-1',
        text: 'Hello',
        context: {
          channel: 'discussion'
        }
      };

      await discussionChannel.inbound?.handleMessage(inboundMsg);

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Session non-existent not found'));
    });

    it('should handle participant not found', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockSession = {
        id: 'room-1',
        topic: 'Test',
        status: 'active',
        participants: [{ agentId: 'agent-2', name: 'Agent 2', role: 'Expert', active: true }],
        messages: []
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockSession)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const inboundMsg: InboundMessage = {
        peer: 'room-1',
        from: 'agent-1', // Not in participants
        text: 'Hello',
        context: {
          channel: 'discussion'
        }
      };

      await discussionChannel.inbound?.handleMessage(inboundMsg);

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Participant agent-1 not found'));
    });
  });

  describe('outbound message sending', () => {
    it('should send outbound message successfully', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockStore = {
        addMessage: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const outboundMsg: OutboundMessage = {
        to: 'room-1',
        agentId: 'agent-1',
        text: 'Response message'
      };

      await discussionChannel.outbound?.sendMessage(outboundMsg);

      expect(mockStore.addMessage).toHaveBeenCalledWith('room-1', {
        participant: 'agent-1',
        content: 'Response message',
        timestamp: expect.any(Number)
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        'discussion:message',
        expect.objectContaining({
          roomId: 'room-1',
          participant: 'agent-1',
          content: 'Response message'
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Message sent to room room-1'));
    });

    it('should handle send errors', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockStore = {
        addMessage: vi.fn().mockRejectedValue(new Error('DB error'))
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const outboundMsg: OutboundMessage = {
        to: 'room-1',
        agentId: 'agent-1',
        text: 'Response message'
      };

      await discussionChannel.outbound?.sendMessage(outboundMsg);

      expect(mockLogger.error).toHaveBeenCalledWith('[DiscussionChannel] Error sending message:', expect.any(Error));
    });
  });

  describe('auto-rotation logic', () => {
    it('should trigger next speaker after message sent', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      let callCount = 0;
      const mockSession = {
        id: 'room-1',
        topic: 'Test',
        status: 'active',
        participants: [
          { agentId: 'agent-1', name: 'Agent 1', role: 'Expert', active: true },
          { agentId: 'agent-2', name: 'Agent 2', role: 'Assistant', active: true }
        ],
        messages: []
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockSession),
        addMessage: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const mockRuntime = {
        executeAgent: vi.fn().mockImplementation(() => {
          callCount++;
          // Stop after 1 call to prevent infinite loop
          if (callCount > 1) {
            mockSession.status = 'completed';
          }
          return Promise.resolve({
            output: 'Response',
            error: undefined
          });
        })
      };

      vi.mocked(ChannelRuntime.getInstance).mockReturnValue(mockRuntime as unknown as ChannelRuntime);

      const inboundMsg: InboundMessage = {
        peer: 'room-1',
        from: 'agent-1',
        text: 'Message',
        context: {
          channel: 'discussion'
        }
      };

      // Use fake timers to control setTimeout
      vi.useFakeTimers();

      const handlePromise = discussionChannel.inbound?.handleMessage(inboundMsg);

      // Wait for initial message handling
      await handlePromise;

      // First call should have been made
      expect(mockRuntime.executeAgent).toHaveBeenCalledTimes(1);

      // Advance timers to trigger next speaker (if status is still active)
      await vi.advanceTimersByTimeAsync(1000);

      vi.useRealTimers();

      // Verify message was handled
      expect(callCount).toBeGreaterThan(0);
    });

    it('should not trigger next speaker when session is paused', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };

      await discussionChannel.lifecycle?.start?.({
        log: mockLogger,
        abortSignal: new AbortController().signal
      });

      const mockSession = {
        id: 'room-1',
        topic: 'Test',
        status: 'paused', // Session is paused
        participants: [
          { agentId: 'agent-1', name: 'Agent 1', role: 'Expert', active: true },
          { agentId: 'agent-2', name: 'Agent 2', role: 'Assistant', active: true }
        ],
        messages: []
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockSession),
        addMessage: vi.fn().mockResolvedValue(undefined)
      };

      vi.mocked(DiscussionStore.getInstance).mockResolvedValue(mockStore as unknown as DiscussionStore);

      const mockRuntime = {
        executeAgent: vi.fn().mockResolvedValue({
          output: 'Response',
          error: undefined
        })
      };

      vi.mocked(ChannelRuntime.getInstance).mockReturnValue(mockRuntime as unknown as ChannelRuntime);

      const inboundMsg: InboundMessage = {
        peer: 'room-1',
        from: 'agent-1',
        text: 'Message',
        context: {
          channel: 'discussion'
        }
      };

      vi.useFakeTimers();

      await discussionChannel.inbound?.handleMessage(inboundMsg);

      // Even after advancing timers, next speaker should not be triggered
      await vi.advanceTimersByTimeAsync(2000);

      vi.useRealTimers();

      // Only the initial call should have been made
      expect(mockRuntime.executeAgent).toHaveBeenCalledTimes(1);
    });
  });
});
