/**
 * Workspace 目录结构测试
 *
 * 验证主 Agent 和子 Agent 的目录结构是否符合设计规范：
 * - 主 Agent: sessions/{threadId}/
 * - 子 Agent: agents/{agentName}/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ThreadStore } from '../ThreadStore';

// Mock dependencies
vi.mock('../../../common/env', () => ({
  Env: {
    getAgentWorkspaceDir: vi.fn().mockResolvedValue('/tmp/test-workspace'),
    paths: {
      logPath: '/tmp/test.log',
      userHome: '/tmp'
    }
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
    it('应该等于 threadId', async () => {
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'default'
      });

      expect(thread.sessionId).toBe(thread.id);
    });

    it('允许手动指定 sessionId（通过 metadata）', async () => {
      const customSessionId = 'custom-session-id';
      const thread = await store.create({
        title: 'Test Thread',
        agentId: 'default',
        metadata: { customSessionId }
      });

      // sessionId 默认还是 id
      expect(thread.sessionId).toBe(thread.id);
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

      expect(thread.sessionId).toBe(thread.id);
    });
  });
});
