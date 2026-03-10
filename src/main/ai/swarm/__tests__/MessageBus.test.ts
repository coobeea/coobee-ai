/**
 * MessageBus 单元测试
 *
 * 测试点对点、广播、话题订阅、未读消息、统计
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus } from '../MessageBus';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  // ========== 发送消息 ==========

  describe('send', () => {
    it('发送点对点消息', () => {
      const msg = bus.send('alice', 'bob', 'hello');

      expect(msg.fromRoleId).toBe('alice');
      expect(msg.toRoleId).toBe('bob');
      expect(msg.content).toBe('hello');
      expect(msg.read).toBe(false);
      expect(msg.priority).toBe('normal');
    });

    it('发送带选项的消息', () => {
      const msg = bus.send('alice', 'bob', 'urgent', {
        topic: 'bug',
        priority: 'urgent',
        data: { bugId: 123 }
      });

      expect(msg.topic).toBe('bug');
      expect(msg.priority).toBe('urgent');
      expect(msg.data).toEqual({ bugId: 123 });
    });

    it('消息 ID 单调递增', () => {
      const m1 = bus.send('a', 'b', '1');
      const m2 = bus.send('a', 'b', '2');

      expect(m1.id).toBe('msg-1');
      expect(m2.id).toBe('msg-2');
    });
  });

  // ========== 广播 ==========

  describe('broadcast', () => {
    it('广播消息 toRoleId 为 *', () => {
      const msg = bus.broadcast('alice', 'attention');

      expect(msg.toRoleId).toBe('*');
    });

    it('任何角色都能接收广播', () => {
      bus.broadcast('alice', 'hello everyone');

      const bobMsgs = bus.getMessagesForRole('bob');
      const charlieMsgs = bus.getMessagesForRole('charlie');

      expect(bobMsgs).toHaveLength(1);
      expect(charlieMsgs).toHaveLength(1);
    });

    it('广播者自己不接收', () => {
      bus.broadcast('alice', 'hello');

      const aliceMsgs = bus.getMessagesForRole('alice');
      expect(aliceMsgs).toHaveLength(0);
    });
  });

  // ========== 接收消息 ==========

  describe('getUnreadMessages', () => {
    it('返回未读消息', () => {
      bus.send('alice', 'bob', 'msg1');
      bus.send('charlie', 'bob', 'msg2');

      const unread = bus.getUnreadMessages('bob');
      expect(unread).toHaveLength(2);
    });

    it('已读消息不返回', () => {
      const msg = bus.send('alice', 'bob', 'msg');
      bus.markAsRead(msg.id);

      const unread = bus.getUnreadMessages('bob');
      expect(unread).toHaveLength(0);
    });

    it('自己发的消息不算未读', () => {
      bus.send('bob', 'alice', 'my msg');

      const unread = bus.getUnreadMessages('bob');
      expect(unread).toHaveLength(0);
    });
  });

  describe('getMessagesForRole', () => {
    it('返回目标角色的所有消息', () => {
      bus.send('alice', 'bob', '1');
      bus.send('charlie', 'bob', '2');
      bus.send('alice', 'charlie', '3');

      const bobMsgs = bus.getMessagesForRole('bob');
      expect(bobMsgs).toHaveLength(2);
    });

    it('limit 限制返回数量', () => {
      for (let i = 0; i < 10; i++) {
        bus.send('alice', 'bob', `msg-${i}`);
      }

      const limited = bus.getMessagesForRole('bob', 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('getConversation', () => {
    it('返回两个角色间的对话', () => {
      bus.send('alice', 'bob', 'hi');
      bus.send('bob', 'alice', 'hello');
      bus.send('charlie', 'alice', 'hey');

      const convo = bus.getConversation('alice', 'bob');
      expect(convo).toHaveLength(2);
    });
  });

  // ========== 话题过滤 ==========

  describe('getMessagesByTopic', () => {
    it('按话题过滤消息', () => {
      bus.send('a', 'b', 'm1', { topic: 'alpha' });
      bus.send('a', 'b', 'm2', { topic: 'beta' });
      bus.send('a', 'b', 'm3', { topic: 'alpha' });

      expect(bus.getMessagesByTopic('alpha')).toHaveLength(2);
      expect(bus.getMessagesByTopic('beta')).toHaveLength(1);
    });
  });

  // ========== 标记已读 ==========

  describe('markAsRead / markAllAsRead', () => {
    it('markAsRead 标记单条已读', () => {
      const msg = bus.send('a', 'b', 'msg');
      bus.markAsRead(msg.id);

      expect(bus.getUnreadMessages('b')).toHaveLength(0);
    });

    it('markAllAsRead 批量标记已读', () => {
      bus.send('a', 'b', '1');
      bus.send('a', 'b', '2');
      bus.markAllAsRead('b');

      expect(bus.getUnreadMessages('b')).toHaveLength(0);
    });
  });

  // ========== 格式化 ==========

  describe('格式化', () => {
    it('formatUnreadForAgent 无消息返回空字符串', () => {
      expect(bus.formatUnreadForAgent('bob')).toBe('');
    });

    it('formatUnreadForAgent 有消息返回格式化文本', () => {
      bus.send('alice', 'bob', 'hello');

      const text = bus.formatUnreadForAgent('bob');
      expect(text).toContain('alice');
      expect(text).toContain('hello');
    });
  });

  // ========== 统计 ==========

  describe('getStats', () => {
    it('返回正确的统计信息', () => {
      bus.send('alice', 'bob', 'm1', { topic: 't1' });
      bus.send('alice', 'charlie', 'm2');
      bus.send('bob', 'alice', 'm3');

      const stats = bus.getStats();
      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByRole['alice']).toBe(2);
      expect(stats.messagesByRole['bob']).toBe(1);
    });
  });

  // ========== 清理 ==========

  describe('清理', () => {
    it('clear 清空消息', () => {
      bus.send('a', 'b', 'msg');
      bus.clear();

      expect(bus.getStats().totalMessages).toBe(0);
    });

    it('destroy 清空消息和监听器', () => {
      bus.send('a', 'b', 'msg');
      bus.destroy();

      expect(bus.getStats().totalMessages).toBe(0);
    });
  });
});
