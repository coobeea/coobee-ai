/**
 * CheckpointManager 单元测试
 *
 * 覆盖：save / load / clear / updateStatus / findPending
 * 使用真实文件系统（临时目录）验证文件读写行为。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ThreadCheckpoint } from '../types';

// Mock logger
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

let tmpDir: string;

// Mock env to use temp dir
vi.mock('@main/common/env', () => ({
  get Env() {
    return {
      paths: {
        workspacesDir: tmpDir
      }
    };
  }
}));

describe('CheckpointManager', () => {
  // 每次测试前重新 import，确保单例重置
  let CheckpointManager: typeof import('../CheckpointManager').CheckpointManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
    // 清除模块缓存以获取新的单例
    vi.resetModules();
    const mod = await import('../CheckpointManager');
    CheckpointManager = mod.CheckpointManager;
    CheckpointManager.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ========== save + load ==========

  describe('save + load', () => {
    it('保存检查点后可以正确读取', async () => {
      const mgr = CheckpointManager.getInstance();
      const cp: ThreadCheckpoint = {
        threadId: 'thread-001',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'running'
      };

      await mgr.save(cp);
      const loaded = await mgr.load('thread-001');

      expect(loaded).not.toBeNull();
      expect(loaded!.threadId).toBe('thread-001');
      expect(loaded!.runStatus).toBe('running');
    });

    it('保存检查点会自动创建目录', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'new-thread',
        updatedAt: new Date().toISOString(),
        runStatus: 'tool-pending'
      });

      const filePath = path.join(tmpDir, 'new-thread', 'checkpoint.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('覆盖写入已有检查点', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'thread-002',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'running'
      });
      await mgr.save({
        threadId: 'thread-002',
        updatedAt: '2025-01-01T01:00:00.000Z',
        runStatus: 'approval-pending',
        pendingOperation: {
          type: 'approval',
          approvalId: 'thread-002:0',
          toolName: 'exec',
          toolCallId: 'tc-1',
          agentSessionId: 'thread-002'
        }
      });

      const loaded = await mgr.load('thread-002');
      expect(loaded!.runStatus).toBe('approval-pending');
      expect(loaded!.pendingOperation?.toolName).toBe('exec');
    });

    it('load 不存在的检查点返回 null', async () => {
      const mgr = CheckpointManager.getInstance();
      const loaded = await mgr.load('nonexistent');
      expect(loaded).toBeNull();
    });
  });

  // ========== clear ==========

  describe('clear', () => {
    it('删除检查点文件', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'thread-clear',
        updatedAt: new Date().toISOString(),
        runStatus: 'running'
      });

      expect(await mgr.load('thread-clear')).not.toBeNull();

      await mgr.clear('thread-clear');

      expect(await mgr.load('thread-clear')).toBeNull();
    });

    it('clear 不存在的检查点不报错', async () => {
      const mgr = CheckpointManager.getInstance();
      await expect(mgr.clear('nonexistent')).resolves.not.toThrow();
    });
  });

  // ========== updateStatus ==========

  describe('updateStatus', () => {
    it('创建新检查点', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.updateStatus('thread-new', 'running');

      const loaded = await mgr.load('thread-new');
      expect(loaded!.runStatus).toBe('running');
      expect(loaded!.updatedAt).toBeDefined();
    });

    it('更新已有检查点的 runStatus', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'thread-update',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'running',
        activeAgent: {
          sessionId: 'thread-update:delegate:reviewer',
          agentId: 'reviewer',
          role: 'delegate',
          workspace: 'agents/reviewer'
        }
      });

      await mgr.updateStatus('thread-update', 'tool-pending');

      const loaded = await mgr.load('thread-update');
      expect(loaded!.runStatus).toBe('tool-pending');
      expect(loaded!.activeAgent).toBeDefined();
    });

    it('idle 状态会清除 activeAgent 和 pendingOperation', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'thread-idle',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'approval-pending',
        activeAgent: {
          sessionId: 's',
          agentId: 'a',
          role: 'delegate',
          workspace: 'w'
        },
        pendingOperation: {
          type: 'approval',
          toolName: 'exec',
          toolCallId: 'tc',
          agentSessionId: 's'
        }
      });

      await mgr.updateStatus('thread-idle', 'idle');

      const loaded = await mgr.load('thread-idle');
      expect(loaded!.runStatus).toBe('idle');
      expect(loaded!.activeAgent).toBeUndefined();
      expect(loaded!.pendingOperation).toBeUndefined();
    });

    it('completed 状态会清除 activeAgent 和 pendingOperation', async () => {
      const mgr = CheckpointManager.getInstance();
      await mgr.save({
        threadId: 'thread-done',
        updatedAt: '2025-01-01T00:00:00.000Z',
        runStatus: 'running',
        activeAgent: {
          sessionId: 's',
          agentId: 'a',
          role: 'worker',
          workspace: 'w'
        }
      });

      await mgr.updateStatus('thread-done', 'completed');

      const loaded = await mgr.load('thread-done');
      expect(loaded!.runStatus).toBe('completed');
      expect(loaded!.activeAgent).toBeUndefined();
    });
  });

  // ========== findPending ==========

  describe('findPending', () => {
    it('找到所有非 idle/completed 的检查点', async () => {
      const mgr = CheckpointManager.getInstance();

      await mgr.save({ threadId: 't-idle', updatedAt: '', runStatus: 'idle' });
      await mgr.save({ threadId: 't-running', updatedAt: '', runStatus: 'running' });
      await mgr.save({ threadId: 't-pending', updatedAt: '', runStatus: 'approval-pending' });
      await mgr.save({ threadId: 't-completed', updatedAt: '', runStatus: 'completed' });
      await mgr.save({ threadId: 't-error', updatedAt: '', runStatus: 'error' });

      const pending = await mgr.findPending();

      expect(pending).toHaveLength(3);
      const ids = pending.map((p) => p.threadId).sort();
      expect(ids).toEqual(['t-error', 't-pending', 't-running']);
    });

    it('空目录返回空数组', async () => {
      const mgr = CheckpointManager.getInstance();
      const pending = await mgr.findPending();
      expect(pending).toEqual([]);
    });

    it('跳过没有 checkpoint.json 的目录', async () => {
      const mgr = CheckpointManager.getInstance();
      fs.mkdirSync(path.join(tmpDir, 'no-checkpoint'), { recursive: true });
      await mgr.save({ threadId: 't-has-cp', updatedAt: '', runStatus: 'running' });

      const pending = await mgr.findPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].threadId).toBe('t-has-cp');
    });

    it('跳过损坏的 checkpoint.json', async () => {
      const mgr = CheckpointManager.getInstance();
      const brokenDir = path.join(tmpDir, 'broken');
      fs.mkdirSync(brokenDir, { recursive: true });
      fs.writeFileSync(path.join(brokenDir, 'checkpoint.json'), 'invalid json', 'utf-8');

      await mgr.save({ threadId: 't-valid', updatedAt: '', runStatus: 'running' });

      const pending = await mgr.findPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].threadId).toBe('t-valid');
    });
  });
});
