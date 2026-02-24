import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionService } from '../SessionService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SessionService', () => {
  let tempDir: string;
  let sessionPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-test-'));
    sessionPath = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('应该创建服务并获取 Session', () => {
    const service = new SessionService({
      sessionId: 'test-session',
      sessionDir: sessionPath,
      agentId: 'agent-1',
      agentName: 'Test Agent'
    });

    const session = service.getSession();
    expect(session).toBeDefined();
    expect(service.getSessionId()).toBe('test-session');
  });

  it('应该返回会话信息', async () => {
    const service = new SessionService({
      sessionId: 'test-session',
      sessionDir: sessionPath,
      agentId: 'agent-1',
      agentName: 'Test Agent'
    });

    const info = await service.getInfo();

    expect(info.sessionId).toBe('test-session');
    expect(info.messageCount).toBe(0);
    expect(info.metadata?.agentId).toBe('agent-1');
    expect(info.metadata?.agentName).toBe('Test Agent');
  });

  it('应该清空会话', async () => {
    const service = new SessionService({
      sessionId: 'test-session',
      sessionDir: sessionPath,
      agentId: 'agent-1',
      agentName: 'Test Agent'
    });

    let info = await service.getInfo();
    expect(info.messageCount).toBe(0);

    await service.clear();

    info = await service.getInfo();
    expect(info.messageCount).toBe(0);
  });
});
