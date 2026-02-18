/**
 * Shared Protocol Types 测试
 *
 * 测试 P0 前后端类型共享：
 * - streaming/types 的 re-export 与 shared/stream-protocol 一致
 * - 类型结构验证（确保协议字段不被意外修改）
 */
import { describe, it, expect } from 'vitest';

// 直接从 shared 导入
import type {
  StreamMessageType as SharedStreamMessageType,
  StreamSource as SharedStreamSource,
  StreamMessage as SharedStreamMessage,
  WsServerMessage,
  WsClientMessage,
  ConnectionState
} from '@shared/stream-protocol';

// 从后端 streaming/types 导入（应该是 shared 的 re-export）
import type {
  StreamMessageType as BackendStreamMessageType,
  StreamSource as BackendStreamSource,
  StreamMessage as BackendStreamMessage
} from '../types';

describe('shared/stream-protocol 类型一致性', () => {
  // 这些测试用运行时值验证类型结构是否正确

  describe('StreamMessage 结构', () => {
    it('StreamMessage 拥有所有必要字段', () => {
      // 构造一个符合 StreamMessage 接口的对象
      const msg: SharedStreamMessage = {
        id: 'msg-1',
        sessionId: 'session-1',
        sequence: 1,
        type: 'text',
        content: 'hello',
        timestamp: Date.now(),
        source: { type: 'agent', id: 'a1', name: 'Agent' }
      };

      expect(msg.id).toBe('msg-1');
      expect(msg.sessionId).toBe('session-1');
      expect(msg.sequence).toBe(1);
      expect(msg.type).toBe('text');
      expect(msg.content).toBe('hello');
      expect(msg.timestamp).toBeGreaterThan(0);
      expect(msg.source.type).toBe('agent');
    });

    it('StreamMessage data 字段可选', () => {
      const msgWithData: SharedStreamMessage = {
        id: '1',
        sessionId: 's1',
        sequence: 1,
        type: 'tool_call',
        content: 'search',
        data: { toolName: 'search', args: {} },
        timestamp: Date.now(),
        source: { type: 'agent', id: 'a1', name: 'A' }
      };

      const msgWithout: SharedStreamMessage = {
        id: '2',
        sessionId: 's1',
        sequence: 2,
        type: 'text',
        content: 'result',
        timestamp: Date.now(),
        source: { type: 'agent', id: 'a1', name: 'A' }
      };

      expect(msgWithData.data).toBeDefined();
      expect(msgWithout.data).toBeUndefined();
    });
  });

  describe('StreamSource 结构', () => {
    it('支持 agent / orchestrator / swarm 三种 source type', () => {
      const sources: SharedStreamSource[] = [
        { type: 'agent', id: 'a1', name: 'Agent' },
        { type: 'orchestrator', id: 'o1', name: 'Orchestrator' },
        { type: 'swarm', id: 's1', name: 'Swarm' }
      ];

      expect(sources).toHaveLength(3);
      expect(sources.map((s) => s.type)).toEqual(['agent', 'orchestrator', 'swarm']);
    });
  });

  describe('StreamMessageType 枚举值', () => {
    it('包含 10 种消息类型', () => {
      const allTypes: SharedStreamMessageType[] = [
        'text',
        'thinking',
        'tool_call',
        'tool_result',
        'handoff',
        'hitl',
        'agent_updated',
        'start',
        'done',
        'error'
      ];

      // 验证每个值都是合法的 StreamMessageType
      expect(allTypes).toHaveLength(10);
    });
  });

  describe('WsServerMessage 消息类型', () => {
    it('stream:message 类型包含 StreamMessage', () => {
      const serverMsg: WsServerMessage = {
        type: 'stream:message',
        data: {
          id: '1',
          sessionId: 's1',
          sequence: 1,
          type: 'text',
          content: 'hello',
          timestamp: Date.now(),
          source: { type: 'agent', id: 'a1', name: 'A' }
        }
      };

      expect(serverMsg.type).toBe('stream:message');
      expect(serverMsg.data.content).toBe('hello');
    });

    it('error 类型包含 error 字段', () => {
      const errorMsg: WsServerMessage = {
        type: 'error',
        data: { error: 'something went wrong' }
      };

      expect(errorMsg.type).toBe('error');
      expect(errorMsg.data.error).toBe('something went wrong');
    });
  });

  describe('WsClientMessage 消息类型', () => {
    it('支持 stream:subscribe 和 stream:unsubscribe', () => {
      const sub: WsClientMessage = { type: 'stream:subscribe', sessionId: 's1' };
      const unsub: WsClientMessage = { type: 'stream:unsubscribe', sessionId: 's1' };

      expect(sub.type).toBe('stream:subscribe');
      expect(unsub.type).toBe('stream:unsubscribe');
    });
  });

  describe('ConnectionState', () => {
    it('四种状态值', () => {
      const states: ConnectionState[] = ['disconnected', 'connecting', 'connected', 'error'];
      expect(states).toHaveLength(4);
    });
  });

  describe('类型兼容性（后端 re-export 与 shared 一致）', () => {
    it('后端 StreamMessage 可赋值给 shared StreamMessage', () => {
      // TypeScript 编译期检查：如果类型不一致会编译失败
      const backendMsg: BackendStreamMessage = {
        id: '1',
        sessionId: 's1',
        sequence: 1,
        type: 'text',
        content: 'hello',
        timestamp: Date.now(),
        source: { type: 'agent', id: 'a1', name: 'A' }
      };

      // 可以赋值给 shared 类型（类型兼容）
      const sharedMsg: SharedStreamMessage = backendMsg;
      expect(sharedMsg.id).toBe('1');
    });

    it('后端 StreamSource 可赋值给 shared StreamSource', () => {
      const backendSource: BackendStreamSource = {
        type: 'agent',
        id: 'a1',
        name: 'Agent'
      };

      const sharedSource: SharedStreamSource = backendSource;
      expect(sharedSource.type).toBe('agent');
    });

    it('后端 StreamMessageType 可赋值给 shared StreamMessageType', () => {
      const backendType: BackendStreamMessageType = 'text';
      const sharedType: SharedStreamMessageType = backendType;
      expect(sharedType).toBe('text');
    });
  });
});
