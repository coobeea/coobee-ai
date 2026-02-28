/**
 * ShortTermMemory 测试
 * TrimmingSession
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TrimmingSession } from '../ShortTermMemory';

describe('TrimmingSession', () => {
  let session: TrimmingSession;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockClient = {} as any;

  beforeEach(() => {
    session = new TrimmingSession(mockClient, { maxTurns: 3 });
  });

  it('addSystemMessage 添加系统消息', async () => {
    await session.addSystemMessage('You are a helper.');
    const msgs = session.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('system');
  });

  it('addUserMessage 添加用户消息', async () => {
    await session.addUserMessage('hello');
    const msgs = session.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('addAssistantMessage 添加助手消息', async () => {
    await session.addAssistantMessage('hi');
    const msgs = session.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
  });

  it('超过 maxTurns 时修剪历史', async () => {
    await session.addSystemMessage('system prompt');

    // 添加 5 轮对话 (maxTurns=3)
    for (let i = 0; i < 5; i++) {
      await session.addUserMessage(`user-${i}`);
      await session.addAssistantMessage(`assistant-${i}`);
    }

    const msgs = session.getMessages();
    // 系统消息 (1) + 最近 3 轮对话 (6) = 7
    expect(msgs.length).toBeLessThanOrEqual(7);
    // 最后一条应该是最近的
    expect(msgs[msgs.length - 1].content).toBe('assistant-4');
  });

  it('clearHistory 保留系统消息', async () => {
    await session.addSystemMessage('sys');
    await session.addUserMessage('user');
    await session.clearHistory();

    const msgs = session.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('system');
  });

  it('reset 完全清空', async () => {
    await session.addSystemMessage('sys');
    await session.addUserMessage('user');
    await session.reset();

    expect(session.getMessages()).toHaveLength(0);
  });

  it('getMessagesForSession 返回副本', async () => {
    await session.addUserMessage('test');
    const msgs = await session.getMessagesForSession();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('test');
  });
});
