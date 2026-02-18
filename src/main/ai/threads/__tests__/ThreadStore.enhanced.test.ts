/**
 * ThreadStore 增强字段测试
 *
 * 验证新增字段：sessionId, agentMode, agentType, runStatus
 * 以及 ThreadIndexEntry 的新字段同步。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock('@main/utils/SnowflakeIdGenerator', () => {
  let counter = 100000000000000000n;
  return {
    generateSnowflakeId: () => {
      counter += 1n;
      return counter.toString();
    }
  };
});

let tmpDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return { paths: { threadsDir: tmpDir } };
  }
}));

describe('ThreadStore 增强字段', () => {
  let ThreadStore: typeof import('../ThreadStore').ThreadStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadstore-test-'));
    vi.resetModules();
    const mod = await import('../ThreadStore');
    ThreadStore = mod.ThreadStore;
    ThreadStore.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create 默认填充 sessionId = id, agentMode = agent, agentType = agent, runStatus = idle', async () => {
    const store = new ThreadStore(tmpDir);
    const thread = await store.create({ title: 'Test', agentId: 'default' });

    expect(thread.sessionId).toBe(thread.id);
    expect(thread.agentMode).toBe('agent');
    expect(thread.agentType).toBe('agent');
    expect(thread.runStatus).toBe('idle');
  });

  it('create 支持自定义 agentMode 和 agentType', async () => {
    const store = new ThreadStore(tmpDir);
    const thread = await store.create({
      title: 'Orchestrator Task',
      agentId: 'orch-1',
      agentMode: 'agent',
      agentType: 'orchestrator'
    });

    expect(thread.agentMode).toBe('agent');
    expect(thread.agentType).toBe('orchestrator');
  });

  it('update 可以修改 runStatus', async () => {
    const store = new ThreadStore(tmpDir);
    const thread = await store.create({ title: 'Task', agentId: 'a1' });

    const updated = await store.update(thread.id, { runStatus: 'running' });
    expect(updated!.runStatus).toBe('running');

    const updated2 = await store.update(thread.id, { runStatus: 'approval-pending' });
    expect(updated2!.runStatus).toBe('approval-pending');
  });

  it('list 返回的索引条目包含 runStatus 和 agentType', async () => {
    const store = new ThreadStore(tmpDir);
    await store.create({ title: 'A', agentId: 'a1', agentType: 'swarm' });
    await store.create({ title: 'B', agentId: 'a2' });

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0].runStatus).toBe('idle');
    expect(list[0].agentType).toBe('agent');
    expect(list[1].runStatus).toBe('idle');
    expect(list[1].agentType).toBe('swarm');
  });

  it('get 返回包含所有新字段的完整定义', async () => {
    const store = new ThreadStore(tmpDir);
    const created = await store.create({
      title: 'Full',
      agentId: 'a1',
      agentMode: 'chat',
      agentType: 'orchestrator'
    });

    const loaded = await store.get(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(created.id);
    expect(loaded!.agentMode).toBe('chat');
    expect(loaded!.agentType).toBe('orchestrator');
    expect(loaded!.runStatus).toBe('idle');
  });

  it('向后兼容：加载缺少新字段的旧 JSON 文件', async () => {
    const store = new ThreadStore(tmpDir);

    // 手动写入旧格式的 JSON
    const oldThread = {
      id: '999999999999999999',
      title: 'Old Thread',
      agentId: 'default',
      status: 'active',
      messageCount: 5,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    fs.writeFileSync(path.join(tmpDir, '999999999999999999.json'), JSON.stringify(oldThread, null, 2), 'utf-8');

    await store.init();
    const list = await store.list();
    expect(list).toHaveLength(1);
    // 旧文件缺少 runStatus 和 agentType，toIndexEntry 使用默认值
    expect(list[0].runStatus).toBe('idle');
    expect(list[0].agentType).toBe('agent');
  });

  it('持久化到磁盘后重新加载保持新字段', async () => {
    const store1 = new ThreadStore(tmpDir);
    const created = await store1.create({
      title: 'Persist Test',
      agentId: 'a1',
      agentType: 'swarm'
    });
    await store1.update(created.id, { runStatus: 'running' });

    // 用新 store 实例重新加载
    const store2 = new ThreadStore(tmpDir);
    const loaded = await store2.get(created.id);
    expect(loaded!.runStatus).toBe('running');
    expect(loaded!.agentType).toBe('swarm');
    expect(loaded!.sessionId).toBe(created.id);
  });
});
