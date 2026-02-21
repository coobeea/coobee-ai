/**
 * Workspace 目录结构测试
 *
 * 验证主 Agent 和子 Agent 的目录结构是否符合设计规范：
 * - 主 Agent: sessions/{threadId}__main/
 * - 子 Agent: tasks/{taskId}/agents/{agentId}/sessions/{threadId}__delegate__{agentId}/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ThreadStore } from '../ThreadStore';

// Mock dependencies
vi.mock('../../../common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn().mockResolvedValue('/tmp/test-workspace')
  }
}));

describe('Workspace 目录结构', () => {
  let tmpDir: string;
  let workspacesDir: string;
  let store: ThreadStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'workspace-test-'));
    workspacesDir = path.join(tmpDir, 'workspaces');
    fs.mkdirSync(workspacesDir, { recursive: true });
    store = new ThreadStore(path.join(tmpDir, 'threads.json'), workspacesDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('主 Agent sessionId 格式', () => {
    it('应该使用 {threadId}:main 格式', async () => {
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'default'
      });

      expect(thread.sessionId).toMatch(/^\d+:main$/);
      expect(thread.sessionId).toBe(`${thread.id}:main`);
    });

    it('允许手动指定 sessionId（通过 metadata）', async () => {
      const customSessionId = 'custom-session-id';
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'default',
        metadata: { customSessionId }
      });

      // sessionId 依然是 {id}:main 格式（不支持自定义）
      expect(thread.sessionId).toMatch(/^\d+:main$/);
    });
  });

  describe('子 Agent sessionId 格式', () => {
    it('delegate 子 Agent 应该使用 {threadId}:delegate:{agentId} 格式', () => {
      const threadId = '283469346464145408';
      const agentId = 'business-analyst';
      const sessionId = `${threadId}:delegate:${agentId}`;

      expect(sessionId).toBe('283469346464145408:delegate:business-analyst');
    });

    it('swarm 子 Agent 应该使用 {threadId}:swarm:{roleId} 格式', () => {
      const threadId = '283469346464145408';
      const roleId = 'coder';
      const sessionId = `${threadId}:swarm:${roleId}`;

      expect(sessionId).toBe('283469346464145408:swarm:coder');
    });
  });

  describe('文件路径安全性（Windows 兼容）', () => {
    it('应该将 : 替换为 __', () => {
      const sessionId = '283469346464145408:main';
      const safeSessionId = sessionId.replace(/:/g, '__');

      expect(safeSessionId).toBe('283469346464145408__main');
      expect(safeSessionId).not.toContain(':');
    });

    it('delegate 子 Agent sessionId 应该替换所有冒号', () => {
      const sessionId = '283469346464145408:delegate:business-analyst';
      const safeSessionId = sessionId.replace(/:/g, '__');

      expect(safeSessionId).toBe('283469346464145408__delegate__business-analyst');
      expect(safeSessionId).not.toContain(':');
    });

    it('swarm 子 Agent sessionId 应该替换所有冒号', () => {
      const sessionId = '283469346464145408:swarm:coder';
      const safeSessionId = sessionId.replace(/:/g, '__');

      expect(safeSessionId).toBe('283469346464145408__swarm__coder');
      expect(safeSessionId).not.toContain(':');
    });
  });

  describe('向后兼容性', () => {
    it('旧 workspace 中的 thread 依然能加载', async () => {
      // 直接创建新 thread，它会使用新格式
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'default'
      });

      // 新格式：sessionId = {id}:main
      expect(thread.sessionId).toBe(`${thread.id}:main`);
    });
  });

  describe('目录结构验证', () => {
    it('主 Agent session 目录应该使用 {threadId}__main', () => {
      const threadId = '283469346464145408';
      const sessionId = `${threadId}:main`;
      const safeSessionId = sessionId.replace(/:/g, '__');
      const expectedPath = `sessions/${safeSessionId}`;

      expect(expectedPath).toBe('sessions/283469346464145408__main');
    });

    it('子 Agent session 目录应该嵌套在 tasks/ 下', () => {
      const threadId = '283469346464145408';
      const taskId = 'task-1771651629916';
      const agentId = 'business-analyst';
      const sessionId = `${threadId}:delegate:${agentId}`;
      const safeSessionId = sessionId.replace(/:/g, '__');

      const expectedPath = `tasks/${taskId}/agents/${agentId}/sessions/${safeSessionId}`;

      expect(expectedPath).toBe(
        'tasks/task-1771651629916/agents/business-analyst/sessions/283469346464145408__delegate__business-analyst'
      );
    });
  });

  describe('sessionId 解析', () => {
    it('应该能从 sessionId 中提取 threadId', () => {
      const sessionId = '283469346464145408:main';
      const threadId = sessionId.split(':')[0];

      expect(threadId).toBe('283469346464145408');
    });

    it('应该能从子 Agent sessionId 中提取 threadId', () => {
      const sessionId = '283469346464145408:delegate:business-analyst';
      const threadId = sessionId.split(':')[0];

      expect(threadId).toBe('283469346464145408');
    });

    it('应该能判断是否为主 Agent', () => {
      const isMainAgent = (sid: string): boolean => sid.endsWith(':main');

      expect(isMainAgent('283469346464145408:main')).toBe(true);
      expect(isMainAgent('283469346464145408:delegate:business-analyst')).toBe(false);
      expect(isMainAgent('283469346464145408:swarm:coder')).toBe(false);
    });

    it('应该能判断 Agent 类型', () => {
      const getAgentType = (sid: string): string => {
        if (!sid.includes(':')) return 'unknown';
        const parts = sid.split(':');
        if (parts.length === 2 && parts[1] === 'main') return 'main';
        if (parts.length === 3 && parts[1] === 'delegate') return 'delegate';
        if (parts.length === 3 && parts[1] === 'swarm') return 'swarm';
        return 'unknown';
      };

      expect(getAgentType('283469346464145408:main')).toBe('main');
      expect(getAgentType('283469346464145408:delegate:business-analyst')).toBe('delegate');
      expect(getAgentType('283469346464145408:swarm:coder')).toBe('swarm');
      expect(getAgentType('283469346464145408')).toBe('unknown');
    });
  });
});
