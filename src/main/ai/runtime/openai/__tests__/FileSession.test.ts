/**
 * FileSession 测试
 *
 * 测试单层 Session 持久化：
 * - JSONL 文件读写
 * - SDK AgentInputItem 直接存储
 * - getItems / addItems / popItem / clearSession
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSession } from '../FileSession';
// Note: FileSession is now in runtime/openai/
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileSession', () => {
  let tempDir: string;
  let session: FileSession;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'filesession-test-'));
    session = new FileSession('test-session-1', tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ===== getSessionId =====

  describe('getSessionId', () => {
    it('返回传入的 sessionId', async () => {
      expect(await session.getSessionId()).toBe('test-session-1');
    });
  });

  // ===== addItems + getItems =====

  describe('addItems / getItems', () => {
    it('初始为空', async () => {
      const items = await session.getItems();
      expect(items).toEqual([]);
    });

    it('追加并读取单条消息', async () => {
      const userMsg = { role: 'user', content: 'Hello' };
      await session.addItems([userMsg as never]);

      const items = await session.getItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(userMsg);
    });

    it('追加多条消息', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];
      await session.addItems(messages as never[]);

      const items = await session.getItems();
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual(messages[0]);
      expect(items[2]).toEqual(messages[2]);
    });

    it('多次追加累积', async () => {
      await session.addItems([{ role: 'user', content: 'msg1' } as never]);
      await session.addItems([{ role: 'assistant', content: 'msg2' } as never]);

      const items = await session.getItems();
      expect(items).toHaveLength(2);
    });

    it('带 limit 参数返回最近 N 条', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: 'user',
        content: `msg-${i}`
      }));
      await session.addItems(messages as never[]);

      const items = await session.getItems(3);
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ role: 'user', content: 'msg-7' });
      expect(items[2]).toEqual({ role: 'user', content: 'msg-9' });
    });
  });

  // ===== popItem =====

  describe('popItem', () => {
    it('空会话返回 undefined', async () => {
      const item = await session.popItem();
      expect(item).toBeUndefined();
    });

    it('弹出最后一条并从文件中移除', async () => {
      await session.addItems([
        { role: 'user', content: 'first' } as never,
        { role: 'assistant', content: 'second' } as never
      ]);

      const popped = await session.popItem();
      expect(popped).toEqual({ role: 'assistant', content: 'second' });

      const remaining = await session.getItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toEqual({ role: 'user', content: 'first' });
    });

    it('连续弹出直到空', async () => {
      await session.addItems([{ role: 'user', content: 'only' } as never]);

      const first = await session.popItem();
      expect(first).toEqual({ role: 'user', content: 'only' });

      const second = await session.popItem();
      expect(second).toBeUndefined();
    });
  });

  // ===== clearSession =====

  describe('clearSession', () => {
    it('清空所有消息', async () => {
      await session.addItems([
        { role: 'user', content: 'hello' } as never,
        { role: 'assistant', content: 'hi' } as never
      ]);

      await session.clearSession();

      const items = await session.getItems();
      expect(items).toEqual([]);
    });

    it('清空后可以继续追加', async () => {
      await session.addItems([{ role: 'user', content: 'old' } as never]);
      await session.clearSession();
      await session.addItems([{ role: 'user', content: 'new' } as never]);

      const items = await session.getItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ role: 'user', content: 'new' });
    });
  });

  // ===== getItemCount =====

  describe('getItemCount', () => {
    it('返回消息数量', async () => {
      expect(await session.getItemCount()).toBe(0);

      await session.addItems([{ role: 'user', content: 'a' } as never, { role: 'user', content: 'b' } as never]);

      expect(await session.getItemCount()).toBe(2);
    });
  });

  // ===== getFilePath =====

  describe('getFilePath', () => {
    it('返回正确的文件路径', () => {
      expect(session.getFilePath()).toContain('test-session-1');
      expect(session.getFilePath()).toContain('messages.jsonl');
    });
  });

  // ===== 边界情况 =====

  describe('边界情况', () => {
    it('存储复杂的 AgentInputItem 格式', async () => {
      const complexItem = {
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: 'Hello world' },
          { type: 'output_text', text: ' and more' }
        ]
      };
      await session.addItems([complexItem as never]);

      const items = await session.getItems();
      expect(items[0]).toEqual(complexItem);
    });

    it('存储工具调用 item', async () => {
      const toolItem = {
        type: 'function_call',
        name: 'get_weather',
        arguments: '{"city": "Beijing"}',
        call_id: 'call-123'
      };
      await session.addItems([toolItem as never]);

      const items = await session.getItems();
      expect(items[0]).toEqual(toolItem);
    });
  });
});
