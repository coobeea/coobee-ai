import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelRuntime } from '../ChannelRuntime';
import { AgentStore } from '@main/ai/agents/AgentStore';
import { agentExecutor } from '@main/ai/AgentExecutor';
import type { ChannelContext } from '../types';
import type { StreamChunk } from '@main/ai/runtime/types';

// Mock dependencies
vi.mock('@main/ai/agents/AgentStore');
vi.mock('@main/ai/AgentExecutor');
vi.mock('@main/ai/tools/registry', () => ({
  ToolRegistry: {
    getInstance: () => ({
      getAll: () => []
    })
  }
}));
vi.mock('@main/ai/skills', () => ({
  SkillManager: vi.fn().mockImplementation(() => ({
    scanSkills: vi.fn(),
    getByName: vi.fn().mockReturnValue(null)
  }))
}));

describe('ChannelRuntime', () => {
  let runtime: ChannelRuntime;

  beforeEach(() => {
    runtime = ChannelRuntime.getInstance();
    vi.clearAllMocks();
  });

  describe('executeAgent', () => {
    it('should execute agent and return output', async () => {
      // Mock agent store
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'You are a test agent'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      // Mock agent executor
      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Hello' };
        yield { type: 'text:delta', content: ' World' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      // Execute
      const context: ChannelContext = {
        channel: 'discussion',
        role: 'participant',
        topic: 'Test Topic'
      };

      const result = await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      // Assertions
      expect(result.output).toBe('Hello World');
      expect(result.error).toBeUndefined();
      expect(mockStore.get).toHaveBeenCalledWith('test-agent');
      expect(agentExecutor.stream).toHaveBeenCalled();
    });

    it('should return error when agent not found', async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue(null)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      const result = await runtime.executeAgent({
        agentId: 'non-existent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      expect(result.output).toBe('');
      expect(result.error).toBe('Agent "non-existent" not found');
    });

    it('should handle execution errors', async () => {
      const mockAgentDef = {
        id: 'error-agent',
        name: 'Error Agent',
        instructions: 'Test'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockImplementation(() => {
        throw new Error('Execution failed');
      });

      const context: ChannelContext = {
        channel: 'discussion'
      };

      const result = await runtime.executeAgent({
        agentId: 'error-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      expect(result.output).toBe('');
      expect(result.error).toBe('Execution failed');
    });
  });

  describe('streamAgent', () => {
    it('should yield stream chunks', async () => {
      const mockAgentDef = {
        id: 'stream-agent',
        name: 'Stream Agent',
        instructions: 'You are a streaming agent'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Chunk 1' };
        yield { type: 'text:delta', content: 'Chunk 2' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      const chunks: StreamChunk[] = [];
      for await (const chunk of runtime.streamAgent({
        agentId: 'stream-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe('Chunk 1');
      expect(chunks[1].content).toBe('Chunk 2');
    });

    it('should yield error when agent not found', async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue(null)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      const chunks: StreamChunk[] = [];
      for await (const chunk of runtime.streamAgent({
        agentId: 'non-existent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('run:error');
      expect(chunks[0].content).toContain('not found');
    });
  });

  describe('context enhancement', () => {
    it('should enhance instructions with discussion context', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Base instructions'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'discussion',
        role: 'Expert',
        topic: 'Test Topic',
        recentMessages: [
          { sender: 'agent-1', content: 'Message 1' },
          { sender: 'agent-2', content: 'Message 2' }
        ]
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      // Check that instructions were enhanced
      expect(mockBuilder.instructions).toHaveBeenCalled();
      const enhancedInstructions = mockBuilder.instructions.mock.calls[0][0];
      expect(enhancedInstructions).toContain('Discussion Context');
      expect(enhancedInstructions).toContain('Expert');
      expect(enhancedInstructions).toContain('Test Topic');
    });

    it('should enhance instructions with feishu context', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Base instructions'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'feishu',
        chatType: 'group',
        chatId: 'oc_xxxxx',
        mentionedBot: true
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      const enhancedInstructions = mockBuilder.instructions.mock.calls[0][0];
      expect(enhancedInstructions).toContain('Feishu Context');
      expect(enhancedInstructions).toContain('group');
      expect(enhancedInstructions).toContain('@mentioned');
    });

    it('should enhance instructions with slack context', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Base instructions'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'slack',
        workspace: 'T123456',
        channelName: '#general',
        threadTs: '1234567890.123456'
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      const enhancedInstructions = mockBuilder.instructions.mock.calls[0][0];
      expect(enhancedInstructions).toContain('Slack Context');
      expect(enhancedInstructions).toContain('T123456');
      expect(enhancedInstructions).toContain('#general');
    });
  });

  describe('tools and skills injection', () => {
    it('should inject tools when specified', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Test',
        tools: ['tool1', 'tool2']
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      // Tools should be called (even if empty due to mock)
      expect(mockBuilder.tools).toHaveBeenCalled();
    });

    it('should set model when specified', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Test',
        model: 'gpt-4'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      expect(mockBuilder.model).toHaveBeenCalledWith('gpt-4');
    });

    it('should set thinking level when specified', async () => {
      const mockAgentDef = {
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'Test',
        thinkingLevel: 'deep'
      };

      const mockStore = {
        get: vi.fn().mockResolvedValue(mockAgentDef)
      };

      vi.mocked(AgentStore.getInstance).mockResolvedValue(mockStore as unknown as AgentStore);

      const mockBuilder = {
        name: vi.fn().mockReturnThis(),
        mode: vi.fn().mockReturnThis(),
        sessionMode: vi.fn().mockReturnThis(),
        instructions: vi.fn().mockReturnThis(),
        tools: vi.fn().mockReturnThis(),
        skills: vi.fn().mockReturnThis(),
        model: vi.fn().mockReturnThis(),
        thinkingLevel: vi.fn().mockReturnThis()
      };

      const mockStream = (async function* () {
        yield { type: 'text:delta', content: 'Response' };
      })();

      vi.mocked(agentExecutor.piMono).mockReturnValue(
        mockBuilder as unknown as ReturnType<typeof agentExecutor.piMono>
      );
      vi.mocked(agentExecutor.stream).mockReturnValue(mockStream as unknown as ReturnType<typeof agentExecutor.stream>);

      const context: ChannelContext = {
        channel: 'discussion'
      };

      await runtime.executeAgent({
        agentId: 'test-agent',
        sessionId: 'test-session',
        message: 'Hello',
        context
      });

      expect(mockBuilder.thinkingLevel).toHaveBeenCalledWith('deep');
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = ChannelRuntime.getInstance();
      const instance2 = ChannelRuntime.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
