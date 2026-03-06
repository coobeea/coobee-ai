/**
 * Agent Home sessions.jsonl 索引功能测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ThreadStore } from '@main/ai/threads/ThreadStore';
import { AgentHomeManager } from '../AgentHomeManager';

describe('Agent Home Sessions Index', () => {
  let tempDir: string;
  let threadsDir: string;
  let workspacesDir: string;
  let homesDir: string;

  beforeEach(async () => {
    const os = await import('node:os');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-session-index-test-'));
    threadsDir = path.join(tempDir, 'threads');
    workspacesDir = path.join(tempDir, 'workspaces');
    homesDir = path.join(tempDir, 'homes');

    fs.mkdirSync(threadsDir, { recursive: true });
    fs.mkdirSync(workspacesDir, { recursive: true });
    fs.mkdirSync(homesDir, { recursive: true });

    ThreadStore.resetInstance();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('创建 thread 时应自动追加到 agent home 的 sessions.jsonl', async () => {
    const store = new ThreadStore(threadsDir, workspacesDir);
    await store.init();

    // 模拟 Env.paths.homesDir（通过设置环境变量）
    const originalEnvGetter = Object.getOwnPropertyDescriptor((await import('@main/common/env')).Env, 'paths');

    Object.defineProperty((await import('@main/common/env')).Env, 'paths', {
      get: () => ({
        homesDir,
        threadsDir,
        workspacesDir
      }),
      configurable: true
    });

    try {
      // 创建 thread
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'test-agent'
      });

      // 验证 sessions.jsonl 被创建
      const sessionsPath = path.join(homesDir, 'test-agent', 'sessions.jsonl');
      expect(fs.existsSync(sessionsPath)).toBe(true);

      // 读取内容
      const content = fs.readFileSync(sessionsPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.id).toBe(thread.id);
      expect(entry.createdAt).toBe(thread.createdAt);
    } finally {
      // 恢复原始的 Env.paths
      if (originalEnvGetter) {
        Object.defineProperty((await import('@main/common/env')).Env, 'paths', originalEnvGetter);
      }
    }
  });

  it('创建多个 thread 时应追加到同一个文件', async () => {
    const store = new ThreadStore(threadsDir, workspacesDir);
    await store.init();

    const originalEnvGetter = Object.getOwnPropertyDescriptor((await import('@main/common/env')).Env, 'paths');

    Object.defineProperty((await import('@main/common/env')).Env, 'paths', {
      get: () => ({
        homesDir,
        threadsDir,
        workspacesDir
      }),
      configurable: true
    });

    try {
      // 创建 3 个 threads
      const thread1 = await store.create({ title: 'Thread 1', agentId: 'test-agent' });
      const thread2 = await store.create({ title: 'Thread 2', agentId: 'test-agent' });
      const thread3 = await store.create({ title: 'Thread 3', agentId: 'test-agent' });

      // 验证内容
      const sessionsPath = path.join(homesDir, 'test-agent', 'sessions.jsonl');
      const content = fs.readFileSync(sessionsPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);

      const entries = lines.map((line) => JSON.parse(line));
      expect(entries[0].id).toBe(thread1.id);
      expect(entries[1].id).toBe(thread2.id);
      expect(entries[2].id).toBe(thread3.id);
    } finally {
      if (originalEnvGetter) {
        Object.defineProperty((await import('@main/common/env')).Env, 'paths', originalEnvGetter);
      }
    }
  });

  it('不同 agent 的 sessions 应分别存储', async () => {
    const store = new ThreadStore(threadsDir, workspacesDir);
    await store.init();

    const originalEnvGetter = Object.getOwnPropertyDescriptor((await import('@main/common/env')).Env, 'paths');

    Object.defineProperty((await import('@main/common/env')).Env, 'paths', {
      get: () => ({
        homesDir,
        threadsDir,
        workspacesDir
      }),
      configurable: true
    });

    try {
      // 创建不同 agent 的 threads
      await store.create({ title: 'Thread A1', agentId: 'agent-a' });
      await store.create({ title: 'Thread A2', agentId: 'agent-a' });
      await store.create({ title: 'Thread B1', agentId: 'agent-b' });

      // 验证 agent-a 的索引
      const sessionsPathA = path.join(homesDir, 'agent-a', 'sessions.jsonl');
      const contentA = fs.readFileSync(sessionsPathA, 'utf-8');
      const linesA = contentA.trim().split('\n');
      expect(linesA.length).toBe(2);

      // 验证 agent-b 的索引
      const sessionsPathB = path.join(homesDir, 'agent-b', 'sessions.jsonl');
      const contentB = fs.readFileSync(sessionsPathB, 'utf-8');
      const linesB = contentB.trim().split('\n');
      expect(linesB.length).toBe(1);
    } finally {
      if (originalEnvGetter) {
        Object.defineProperty((await import('@main/common/env')).Env, 'paths', originalEnvGetter);
      }
    }
  });

  it('AgentHomeManager 应能正确读取 sessions 索引', async () => {
    // 手动创建 sessions.jsonl
    const agentId = 'test-agent';
    const homeDir = path.join(homesDir, agentId);
    fs.mkdirSync(homeDir, { recursive: true });

    const sessionsPath = path.join(homeDir, 'sessions.jsonl');
    const entries = [
      { id: '123456789', createdAt: '2026-03-06T10:00:00.000Z' },
      { id: '123456790', createdAt: '2026-03-06T11:00:00.000Z' }
    ];

    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(sessionsPath, content, 'utf-8');

    // 使用 AgentHomeManager 读取
    const manager = new AgentHomeManager(homesDir);
    const result = manager.readSessionIndex(agentId);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe('123456789');
    expect(result[1].id).toBe('123456790');
  });

  it('读取不存在的 agent 应返回空数组', () => {
    const manager = new AgentHomeManager(homesDir);
    const result = manager.readSessionIndex('non-existent-agent');

    expect(result).toEqual([]);
  });

  it('sessions.jsonl 为空时应返回空数组', () => {
    const agentId = 'test-agent';
    const homeDir = path.join(homesDir, agentId);
    fs.mkdirSync(homeDir, { recursive: true });

    const sessionsPath = path.join(homeDir, 'sessions.jsonl');
    fs.writeFileSync(sessionsPath, '', 'utf-8');

    const manager = new AgentHomeManager(homesDir);
    const result = manager.readSessionIndex(agentId);

    expect(result).toEqual([]);
  });
});
